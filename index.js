const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");
require("dotenv").config();


const app = express();
const bodyParser = require("body-parser");
const port = 3000;

const knex = require("knex")({
    client: "pg",
    connection: {
        host: process.env.DB_HOST || "localhost",
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 5432,
        ssl: { rejectUnauthorized: false },
    },
});

// Middleware to parse POST request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration
app.use(
    session({
        secret: process.env.SESSION_SECRET || "yourSecretKey",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === "production",
            httpOnly: true,
        },
    })
);

// Set view engine and views folder
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Serve static files (like CSS)
app.use(express.static(path.join(__dirname, "public")));

// Middleware for protected routes
function authMiddleware(req, res, next) {
    if (!req.session.userId) {
        return res.redirect("/login");
    }
    next();
}

// Check if ANY user is logged in
function isLoggedIn(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.status(403).send("Access denied");
    }
}

// Check if an admin is logged in
function isAdmin(req, res, next) {
    if (req.session.role === "admin") {
        next();
    } else {
        res.status(403).send("Access denied");
    }
}

// Check if a volunteer is logged in
function isVolunteer(req, res, next) {
    if (req.session.role === "volunteer") {
        next();
    } else {
        res.status(403).send("Access denied");
    }
}

app.get("/", async (req, res) => {
    try {
        let user = false;

      // Check if a user is logged
      if (req.session.userId) {
        user = true;
      }
  
      // Render index.ejs and pass if user is logged in
      res.render("index", { user });
    } catch (error) {
      console.error("Error fetching user details:", error);
      res.status(500).send("Server error");
    }
});



// Login Page
app.get("/login", (req, res) => {
    if (!req.session.userId) {
        res.render("login");
    } else {
        res.redirect("/dashboard");
    }
});

// Signup Page
app.get("/signup", (req, res) => {
    res.render("signup");
});

app.post("/signup", async (req, res) => {
    const {
        first_name,
        last_name,
        email,
        phone,
        username,
        password,
        con_password,
        admin_key,
    } = req.body;

    if (password !== con_password) {
        return res.status(400).send("Passwords do not match.");
    }

    const isAdmin = admin_key === process.env.ADMIN_CREATE_KEY;
    const user_type = isAdmin ? "admin" : "volunteer";

    if (admin_key && !isAdmin) {
        return res.status(400).send("Invalid admin key.");
    }

    try {
        // Insert into the `users` table and get the auto-generated `user_id`
        const [user_id] = await knex("users")
            .insert({
                username,
                user_password: password, // Store password as plain text (not recommended for production)
                user_type,
            })
            .returning("user_id");

        // Insert into `admins` or `volunteers` table using the same `user_id` as `admin_id` or `vol_id`
        if (isAdmin) {
            await knex("admins").insert({
                admin_id: user_id, // Use the auto-generated `user_id`
                first_name,
                last_name,
                email,
                phone,
            });
        } else {
            await knex("volunteers").insert({
                vol_id: user_id, // Use the auto-generated `user_id`
                first_name,
                last_name,
                email,
                phone,
            });
        }

        res.redirect("/login");
    } catch (error) {
        console.error("Error registering user:", error);
        res.status(500).send("Server error.");
    }
});

// Admin Event Manager Page
app.get("/medicine_cabinet", authMiddleware, async (req, res) => {
  try {
      // Fetch the user's ID from the session
      const userId = req.session.userId;

      // Query the database
      const medicines = await knex('medicine')
          .join('dosage', 'medicine.medicine_id', 'dosage.medicine_id') // Join with the dosage table
          .join('patients', 'dosage.patient_id', 'patients.patient_id') // Join with the patients table
          .leftJoin('family_members', 'patients.user_id', 'family_members.related_user_id') // Link family members
          .leftJoin('medicine_description', 'medicine.medicine_id', 'medicine_description.medicine_id') // Join medicine descriptions
          .select(
              'medicine.name',
              'medicine.type',
              'medicine.expiration_date',
              'medicine_description.description',
              'medicine_description.side_effects',
              'medicine_description.warnings'
          )
          .where(function () {
              // Match medicines to the logged-in user or their family members
              this.where('patients.user_id', userId).orWhere('family_members.user_id', userId);
          });

      // Render the medicine cabinet page with the filtered data
      res.render("medicine_cabinet", { medicines });
  } catch (error) {
      console.error('Error fetching medicines:', error);
      res.status(500).send('Error fetching medicine cabinet data.');
  }
});

// GET route to display the add_medicine form
app.get('/add_medicine', (req, res) => {
  knex('medicine').select('name', 'type', 'expiration_date')
      .then(medicines => {
          knex('medicine_description').select('description', 'side_effects', 'warnings')
              .then(descriptions => {
                  res.render('add_medicine', { medicines, descriptions });
              })
              .catch(error => {
                  console.error('Error fetching medicine descriptions:', error);
                  res.status(500).send('Something went wrong');
              });
      })
      .catch(error => {
          console.error('Error fetching medicines:', error);
          res.status(500).send('Something went wrong');
      });
});

// POST route to add a new medicine record
app.post('/add_medicine', (req, res) => {
  const {
      medicine_name,
      medicine_type,
      expiration_date,
      description,
      side_effects,
      warnings
  } = req.body;

  // Insert medicine data into the 'medicine' table
  knex('medicine')
      .insert({
          name: medicine_name,
          type: medicine_type,
          expiration_date: expiration_date
      })
      .returning('medicine_id') // Retrieve the 'medicine_id' of the inserted row
      .then(([medicine_id]) => {
          // Now that we have the medicine_id, insert into 'medicine_description'
          return knex('medicine_description').insert({
              medicine_id: medicine_id,  // Use the inserted medicine_id here
              description: description,
              side_effects: side_effects,
              warnings: warnings
          });
      })
      .then(() => {
          // After successful insert, redirect to the add_medicine page
          res.redirect('/add_medicine');
      })
      .catch((error) => {
          console.error('Error inserting medicine description:', error);
          res.status(500).send('Something went wrong');
      });
});



app.get("/prescription", authMiddleware, async (req, res) => {
  try {
      // Fetch the user's ID from the session
      const userId = req.session.userId;

      // Query the database
      const medicineDetails = await knex('dosage')
          .join('medicine', 'dosage.medicine_id', 'medicine.medicine_id') // Join with the medicine table
          .join('patients', 'dosage.patient_id', 'patients.patient_id') // Join with the patients table
          .leftJoin('family_members', 'patients.user_id', 'family_members.related_user_id') // Link family members
          .select(
              'patients.first_name', // Patient's first name
              'medicine.name as medicine_name', // Medicine name
              'dosage.dosage', // Dosage
              'dosage.frequency', // Frequency
              'dosage.start_date', // Start date
              'dosage.end_date' // End date
          )
          .where(function () {
              // Match records to the logged-in user or their family members
              this.where('patients.user_id', userId).orWhere('family_members.user_id', userId);
          });

      // Render the medicine cabinet page with the filtered data
      res.render("prescription", { medicines: medicineDetails });
  } catch (error) {
      console.error('Error fetching medicine details:', error);
      res.status(500).send('Error fetching medicine cabinet data.');
  }
});

// add prescription route
app.get("/add_prescription", authMiddleware, async (req, res) => {
  try {
      const userId = req.session.userId;

      // Fetch patients related to the user
      const patients = await knex('patients')
          .leftJoin('family_members', 'patients.user_id', 'family_members.related_user_id')
          .select('patients.patient_id', 'patients.first_name', 'patients.last_name')
          .where(function () {
              this.where('patients.user_id', userId).orWhere('family_members.user_id', userId);
          });

      res.render("add_prescription", { patients });
  } catch (error) {
      console.error('Error loading add prescription page:', error);
      res.status(500).send('Error loading page.');
  }
});

app.post("/add_prescription", async (req, res) => {
  try {
      const { patient_id, medicine_name, dosage, frequency, start_date, end_date } = req.body;

      // Check if the medicine already exists in the database
      const existingMedicine = await knex("medicine")
          .select("medicine_id")
          .where("name", medicine_name)
          .first();

      if (existingMedicine) {
          // Medicine exists, proceed to add prescription
          await knex("dosage").insert({
              patient_id,
              medicine_id: existingMedicine.medicine_id,
              dosage,
              frequency,
              start_date,
              end_date,
          });

          res.redirect("/prescription"); // Redirect to a success page or list of prescriptions
      } else {
          // Redirect to the add_medicine page with the medicine_name pre-filled
          res.redirect(`/add_medicine?medicine_name=${encodeURIComponent(medicine_name)}`);
      }
  } catch (error) {
      console.error("Error adding prescription:", error);
      res.status(500).send("Error adding prescription.");
  }
});

app.get('/delete_prescription/:dosage_id', async (req, res) => {
  const dosage_id = req.params.dosage_id;

  try {
    // Use Knex to delete the event from the database
    await knex('dosage').where('dosage_id', dosage_id).del();
    
    // Redirect to the event manager page after successful deletion
    res.redirect('/prescription');
  } catch (err) {
    console.error("Error deleting prescription:", err);
    
    // Redirect to the event manager page in case of an error (you can add an error message if needed)
    res.redirect('/prescription');
  }
});



//edit volunteer GET route
app.get('/edit_volunteer/:vol_id', isAdmin, async (req, res) => {
  const vol_id = req.params.vol_id;
  try {
    const volunteers = await knex('volunteers').where({ "vol_id": vol_id }).first();
    if (!volunteers) {
      return res.status(404).send('Volunteer not found');
    }
    res.render('edit_volunteer', { volunteers, userRole: req.session.role });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

//edit volunteer POST route
app.post('/edit_volunteer/:vol_id', async (req, res) => {
  const vol_id= req.params.vol_id;
  const volData = req.body;

  try {
    // Update the event using Knex
    await knex('volunteers')
      .where({ vol_id })
      .update({
        volunteer_first_name: volData.volunteer_first_name,
        volunteer_last_name: volData.volunteer_last_name,
        volunteer_email: volData.volunteer_email,
        volunteer_phone: volData.volunteer_phone,
        volunteer_city: volData.volunteer_city,
        volunteer_county: volData.volunteer_county,
        volunteer_state: volData.volunteer_state,
        volunteer_preference: volData.volunteer_preference,
        volunteer_enroll_date: volData.volunteer_enroll_date,
        volunteer_how_heard: volData.volunteer_how_heard,
        volunteer_sewing_level: volData.volunteer_sewing_level,
        volunteer_hrs_monthly_availability: volData.volunteer_hrs_monthly_availability,
        volunteer_approved: volData.volunteer_approved,
      });

    res.redirect('/volunteer_manager');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});



//edit_events GET route
app.get('/edit_events/:eventId', isAdmin, async (req, res) => {
  const eventId = req.params.eventId;
  try {
    const events= await knex('events').where({ "event_id": eventId }).first();
    if (!events) {
      return res.status(404).send('Event not found');
    }
    const stateAbbreviations = [
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
      'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
      'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
      'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
      'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
    ];
    res.render('edit_events', { events, stateAbbreviations, userRole: req.session.role });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

//edit_events POST route
app.post('/edit_events/:event_id', async (req, res) => {
  const eventId = req.params.event_id;
  const eventData = req.body;

  try {
    // Update the event using Knex
    await knex('events')
      .where({ event_id: eventId })
      .update({
        event_name: eventData.event_name,
        event_status: eventData.event_status,
        event_date_time: eventData.event_date_time,
        event_city: eventData.event_city,
        event_county: eventData.event_county,
        event_state: eventData.event_state,
        event_street_address: eventData.event_street_address,
        event_zip: eventData.event_zip,
        event_duration_hrs: eventData.event_duration_hrs,
        number_of_participants_expected: eventData.number_of_participants_expected,
        event_type: eventData.event_type,
        event_contact_first_name: eventData.event_contact_first_name,
        event_contact_last_name: eventData.event_contact_last_name,
        event_contact_phone: eventData.event_contact_phone,
        event_contact_email: eventData.event_contact_email,
        event_jen_story: eventData.event_jen_story === 'true', // convert to boolean
        event_donate_money: eventData.event_donate_money === 'true', // convert to boolean
      });

    res.redirect('/event_manager');
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// // Delete Event
app.get('/delete_event/:event_id', isAdmin, async (req, res) => {
    const eventId = req.params.event_id;
  
    try {
      // Use Knex to delete the event from the database
      await knex('events').where('event_id', eventId).del();
      
      // Redirect to the event manager page after successful deletion
      res.redirect('/event_manager');
    } catch (err) {
      console.error("Error deleting event:", err);
      
      // Redirect to the event manager page in case of an error (you can add an error message if needed)
      res.redirect('/event_manager');
    }
  });

app.get('/delete_volunteer/:vol_id', async (req, res) => {
  const vol_id = req.params.vol_id;

  try {
    // Use Knex to delete the event from the database
    await knex('volunteers').where('vol_id', vol_id).del();
    
    // Redirect to the event manager page after successful deletion
    res.redirect('/volunteer_manager');
  } catch (err) {
    console.error("Error deleting volunteer:", err);
    
    // Redirect to the event manager page in case of an error (you can add an error message if needed)
    res.redirect('/volunteer_manager');
  }
});
  
  


// Login Route
app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        const users = await knex("users")
            .where({ username, password: password })
            .first();

        if (!users) {
            console.log("Invalid username or password");
            return res.status(401).send("Invalid username or password");
        }

        // Set session variables
        req.session.userId = users.user_id;
        // req.session.role = users.user_type;

        // Redirect based on role
        res.redirect("/dashboard");
    } catch (err) {
        console.error("Error during login:", err);
        res.status(500).send("Server error");
    }
});

app.get('/dashboard', authMiddleware, isLoggedIn, async (req, res) => {
  try {
      // Query to get the logged-in user's first name
      const userDetails = await knex('users')
          .innerJoin('family_members', 'users.user_id', 'family_members.user_id')
          .innerJoin('patients', 'family_members.patient_id', 'patients.patient_id')
          .select('patients.first_name', 'patients.last_name')
          .where('users.user_id', req.session.userId) // Use the user_id from the session
          .first(); // Ensure only one result is returned

      if (!userDetails) {
          return res.status(404).send('User not found');
      }

      // Pass the userDetails to the EJS template
      res.render('dashboard', { userDetails });
  } catch (error) {
      console.error('Error fetching user details:', error);
      res.status(500).send('Server error');
  }
});




// Logout Route
app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error during logout:", err);
            return res.status(500).send("Server error");
        }
        res.clearCookie("connect.sid");
        res.redirect("/");
    });
});

// Register New User (For testing purposes only)
// app.post("/register", async (req, res) => {
//     const { username, password, user_type } = req.body;

//     const hashedPassword = await bcrypt.hash(password, 10);

//     try {
//         await knex("users").insert({
//             username,
//             user_password: hashedPassword,
//             user_type,
//         });
//         res.send("User registered successfully!");
//     } catch (error) {
//         console.error("Error registering user:", error);
//         res.status(500).send("Server error");
//     }
// });

const stateAbbreviations = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];

//GET route for event page
app.get('/request_event', (req, res) => {
  knex('events').select('*')
    .then(result => {
      res.render('request_event', { events: result, stateAbbreviations: stateAbbreviations });
    })
    .catch(error => {
      console.error('Error fetching events:', error);
      res.status(500).send('Something went wrong');
    });
});

// POST route to request an event
app.post("/request_event", (req, res) => {
    const {
        event_name,
        number_of_participants_expected,
        event_type,
        event_date_time,
        event_street_address,
        event_city,
        event_county,
        event_state,
        event_zip,
        event_duration_hrs,
        event_contact_first_name,
        event_contact_last_name,
        event_contact_phone,
        event_contact_email,
        event_jen_story,
        event_donate_money,
    } = req.body;

    knex("events")
        .insert({
            event_name,
            number_of_participants_expected,
            event_type,
            event_date_time,
            event_street_address,
            event_city,
            event_county,
            event_state,
            event_zip,
            event_duration_hrs,
            event_contact_first_name,
            event_contact_last_name,
            event_contact_phone,
            event_contact_email,
            event_jen_story,
            event_donate_money,
            event_status: "pending",
        })
        .then(() => {
            res.redirect("/request_event");
        })
        .catch((error) => {
            console.error("Error inserting event:", error);
            res.status(500).send("Something went wrong");
        });
});

//GET route for volunteer page
app.get('/request_volunteer', (req, res) => {
  knex('volunteers').select('*')
    .then(result => {
      res.render('request_volunteer', { volunteers: result });
    })
    .catch(error => {
      console.error('Error fetching events:', error);
      res.status(500).send('Something went wrong');
    });
});

// POST route to request to be a volunteer
app.post("/request_volunteer", (req, res) => {
  const {
      volunteer_first_name,
      volunteer_last_name,
      volunteer_enroll_date,
      volunteer_how_heard,
      volunteer_sewing_level,
      volunteer_hrs_monthly_availability,
      volunteer_email,
      volunteer_phone,
      volunteer_city,
      volunteer_county,
      volunteer_state,
      volunteer_preference,
      volunteer_approved
  } = req.body;

  knex("volunteers")
      .insert({
          volunteer_first_name,
          volunteer_last_name,
          volunteer_enroll_date,
          volunteer_how_heard,
          volunteer_sewing_level,
          volunteer_hrs_monthly_availability,
          volunteer_email,
          volunteer_phone,
          volunteer_city,
          volunteer_county,
          volunteer_state,
          volunteer_preference,
          volunteer_approved: "false"
      })
      .then(() => {
              res.render("request_volunteer");
      })
      .catch((error) => {
          console.error("Error inserting event:", error);
          res.status(500).send("Something went wrong");
      });
});

// edit profile page
app.get("/edit_profile", isLoggedIn, (req, res) => {
  const userId = req.session.userId; // Assuming you store the user ID in the session
  
  knex("users")
      .where({ user_id: userId })
      .first()
      .then((user) => {
          if (!user) {
              return res.redirect("/login"); // If user doesn't exist, redirect to login
          }
          res.render("edit_profile", { user });
      })
      .catch((error) => {
          console.error("Error fetching user data:", error);
          res.status(500).send("Internal server error");
      });
});

app.post("/update_profile", (req, res) => {
  const userId = req.session.userId; // Assuming user ID is stored in session
  const { username, password, updateType } = req.body; // Get form data from request body

  // Determine the update type
  let updateData = {};
  if (updateType === "username" && username) {
    updateData.username = username;
  } else if (updateType === "password" && password) {
    updateData.password = password;
  }

  // If no valid data is provided, redirect back with an error
  if (Object.keys(updateData).length === 0) {
    return res.status(400).send("No valid data provided for update.");
  }
  knex("users")
      .where({ user_id: userId })
      .update({ username: username, user_password: password })
      .then(() => {
        res.redirect("/dashboard"); // Redirect back to the edit profile page
      })
      .catch((error) => {
          console.error("Error updating profile:", error);
          res.status(500).send("Internal server error");
      });
});

//event_production_report
app.get('/event_production_report/:event_id', isAdmin, async (req, res) => {
    const { event_id } = req.params; // Get the event_id from the route parameters

    try {
        const completedEvents = await knex('events as e')
            .leftJoin('event_production as ep', 'e.event_id', 'ep.event_id')
            .leftJoin('inventory as i', 'ep.inventory_id', 'i.inventory_id') // Join with the inventory table
            .select(
                'e.event_id',
                'e.event_name',
                'e.event_type',
                'e.number_of_participants_expected',
                'e.event_date_time',
                'e.event_city',
                'e.event_state',
                'e.event_jen_story',
                'e.event_contact_first_name',
                'e.event_contact_last_name',
                'e.event_contact_phone',
                'ep.item_count',
                'ep.total_attendees_actual',
                'ep.event_duration_actual',
                'i.inventory_name',        // Select inventory_name
                'i.inventory_size'         // Select inventory_size
            )
            .where('e.event_id', event_id); // Filter by the specific event_id

        res.render('event_production_report', { completedEvents });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching event production report.');
    }
});

//update event production
// GET route to render the form
app.get('/update_event_production/:event_id', isAdmin, async (req, res) => {
    const eventId = req.params.event_id;

    try {
        const event = await knex('events')
            .leftJoin('event_production', 'events.event_id', 'event_production.event_id')
            .select(
                'events.event_id',
                'events.event_name',
                'event_production.item_count',
                'event_production.total_attendees_actual',
                'event_production.event_duration_actual'
            )
            .where('events.event_id', eventId)
            .first();

        if (!event) {
            return res.status(404).send('Event not found.');
        }

        res.render('update_event_production', { event });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching event production details.');
    }
});

app.post('/update_event_production/:event_id', (req, res) => {
    const eventId = req.params.event_id;
    const { inventory_name, inventory_size, item_count, total_attendees_actual, event_duration_actual } = req.body;

    // Convert inventory_name and inventory_size to lowercase to ensure case-insensitive comparison
    const normalizedInventoryName = inventory_name.toLowerCase();
    const normalizedInventorySize = inventory_size.toLowerCase();

    // Fetch the inventory_id based on normalized inventory_name and inventory_size
    knex('inventory')
        .where({ inventory_name: normalizedInventoryName, inventory_size: normalizedInventorySize })
        .first()
        .then(inventory => {
            if (!inventory) {
                return res.status(400).send('Invalid inventory selection.');
            }
            const inventory_id = inventory.inventory_id;
            const current_inventory_quantity = inventory.inventory_quantity; // Get current inventory quantity

            // Calculate the new inventory quantity
            const new_inventory_quantity = current_inventory_quantity + parseInt(item_count);

            // Start a transaction to update both the inventory and event_production tables
            return knex.transaction(trx => {
                // Update the inventory table with the new inventory quantity
                return trx('inventory')
                    .where('inventory_id', inventory_id)
                    .update({
                        inventory_quantity: new_inventory_quantity
                    })
                    .then(() => {
                        // Check if the event_production record exists
                        return trx('event_production')
                            .where({ event_id: eventId, inventory_id: inventory_id })
                            .first()
                            .then(eventProduction => {
                                if (eventProduction) {
                                    // If the record exists, update the values
                                    return trx('event_production')
                                        .where({ event_id: eventId, inventory_id: inventory_id })
                                        .update({
                                            item_count: eventProduction.item_count + parseInt(item_count),
                                            total_attendees_actual,
                                            event_duration_actual
                                        });
                                } else {
                                    // If the record doesn't exist, insert a new one
                                    return trx('event_production')
                                        .insert({
                                            event_id: eventId,
                                            inventory_id: inventory_id,
                                            item_count: item_count,
                                            total_attendees_actual,
                                            event_duration_actual
                                        });
                                }
                            });
                    });
            })
            .then(() => {
                res.redirect(`/event_production_report/${eventId}`);

            })
            .catch(err => {
                console.error('Error updating event production:', err);
                res.status(500).send('Error updating event production.');
            });
        })
        .catch(err => {
            console.error('Error querying inventory:', err);
            res.status(500).send('Error querying inventory.');
        });
});

//inventory view
// Serve the inventory view page
app.get('/inventory_view', isAdmin, (req, res) => {
    // Fetch all inventory items from the database
    knex('inventory')
        .select('*')
        .then(inventory => {
            // Render the inventory view and pass the data to the template
            res.render('inventory_view', { inventory: inventory });
        })
        .catch(err => {
            console.error('Error fetching inventory:', err);
            res.status(500).send('Error fetching inventory');
        });
});

// Route to update inventory quantity
app.post('/update_inventory/:inventory_id', (req, res) => {
    const inventoryId = req.params.inventory_id;
    const newQuantity = req.body.inventory_quantity;

    // Using Knex to update the inventory_quantity
    knex('inventory')
        .where('inventory_id', inventoryId)
        .update({ inventory_quantity: newQuantity })
        .then(() => {
            console.log(`Updated inventory ${inventoryId} with new quantity: ${newQuantity}`);
            res.redirect('/inventory_view');  // Redirect back to the inventory view
        })
        .catch(err => {
            console.error('Error updating inventory:', err);
            res.status(500).send('Error updating inventory');
        });
});

// Route for signed in volunteers to view and sign up for events
app.get("/volunteer_now", authMiddleware, isVolunteer, async (req, res) => {
    try {
      // Fetch volunteer data
      const volunteer = await knex('volunteers')
        .select('*')
        .where('user_id', req.session.userId)
        .first();
  
      if (!volunteer) {
        return res.status(404).send('Volunteer not found');
      }
  
      // Fetch approved events
      const events = await knex('events')
        .select('*')
        .where('event_status', 'approved');
  
      // Render the view with both volunteer and events data
      res.render("volunteer_now", { volunteer, events });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).send('Something went wrong');
    }
});

const nodemailer = require('nodemailer');
app.post('/volunteer_now', authMiddleware, isVolunteer, async (req, res) => {
    const { volunteerName, eventName, eventDate } = req.body;

    // Log received data
    console.log("Received data:", { volunteerName, eventName, eventDate });

    // Verify required fields
    if (!volunteerName || !eventName || !eventDate) {
        console.error("Missing required information.");
        return res.status(400).send('Missing required information.');
    }

    try {
        // Configure nodemailer transporter
        console.log("Configuring transporter...");
        const transporter = nodemailer.createTransport({
            service: 'Gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
        console.log("Transporter configured.");

        // Format the event date
        const formattedDate = new Date(eventDate).toLocaleString('en-US', {
            month: 'long',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        console.log("Formatted event date:", formattedDate);

        // Define email options
        const mailOptions = {
            from: `"Turtle Shelter Project" <${process.env.EMAIL_USER}>`,
            to: process.env.NOTIFICATION_EMAIL, // Replace with the recipient email address
            subject: `Volunteer Sign-Up: ${eventName}`,
            text: `Hi,\n\n${volunteerName} has signed up for the following event:\n\nEvent Name: ${eventName}\nEvent Date: ${formattedDate}\n\nBest regards,\nTurtle Shelter Team`,
            html: `<p>Hi,</p><p><strong>${volunteerName}</strong> has signed up for the following event:</p><ul><li><strong>Event Name:</strong> ${eventName}</li><li><strong>Event Date:</strong> ${formattedDate}</li></ul><p>Best regards,<br>Turtle Shelter Team</p>`
        };

        console.log("Mail options:", mailOptions);

        // Send the email
        const result = await transporter.sendMail(mailOptions);
        console.log("Email sent successfully:", result);
        res.status(200).send('Sign-up successful and email sent.');
    } catch (error) {
        console.error("Error sending email:", error);
        res.status(500).send('Something went wrong.');
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

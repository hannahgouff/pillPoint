const express = require("express");
const session = require("express-session");
const path = require("path");
require("dotenv").config();

const app = express();
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
            .leftJoin('patients', 'users.user_id', 'patients.user_id')
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

app.get("/medicine_cabinet", authMiddleware, async (req, res) => {
    try {
        // Fetch the user's ID from the session
        const userId = req.session.userId;

        // Query the database
        const medicines = await knex('medicine')
            .leftJoin('dosage', 'medicine.medicine_id', 'dosage.medicine_id') // Use LEFT JOIN to include medicines without dosage
            .leftJoin('patients', 'dosage.patient_id', 'patients.patient_id') // Use LEFT JOIN for optional patient data
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
                // Include medicines linked to the user or with no patient association
                this.where('patients.user_id', userId).orWhereNull('patients.user_id');
            });

        // Render the medicine cabinet page with the data
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

app.post('/add_medicine', isLoggedIn, async (req, res) => {
    const {
        medicine_name,
        medicine_type,
        medicine_expiration,
        medicine_description,
        side_effects,
        warnings
    } = req.body;

    try {
        // Insert medicine data into the 'medicine' table and retrieve the 'medicine_id'
        const insertedMed = await knex('medicine')
            .insert({
                name: medicine_name,
                type: medicine_type,
                expiration_date: medicine_expiration
            })
            .returning('medicine_id'); // Retrieve the 'medicine_id' of the inserted row

        // Extract the actual medicine_id value
        const medicine_id = Array.isArray(insertedMed)
            ? insertedMed[0].medicine_id || insertedMed[0] // For PostgreSQL (object) or SQLite (integer)
            : insertedMed; // For SQLite (integer)

        if (medicine_id) {
            // Insert into 'medicine_description' using the retrieved `medicine_id`
            await knex('medicine_description').insert({
                medicine_id, // Use the extracted medicine_id here
                description: medicine_description,
                side_effects: side_effects,
                warnings: warnings
            });

            // After successful inserts, redirect to the desired page
            res.redirect('/medicine_cabinet');
        } else {
            throw new Error('Failed to retrieve medicine_id');
        }
    } catch (error) {
        console.error('Error processing medicine information:', error);
        res.status(500).send('Something went wrong');
    }
});

// app.get("/prescription", authMiddleware, async (req, res) => {
//   try {
//       // Fetch the user's ID from the session
//       const userId = req.session.userId;

//       // Query the database
//       const medicines = await knex('dosage')
//           .join('medicine', 'dosage.medicine_id', 'medicine.medicine_id') // Join with the medicine table
//           .join('patients', 'dosage.patient_id', 'patients.patient_id') // Join with the patients table
//           .select(
//               'patients.first_name', // Patient's first name
//               'medicine.name as medicine_name', // Medicine name
//               'dosage.dosage', // Dosage
//               'dosage.frequency', // Frequency
//               'dosage.start_date', // Start date
//               'dosage.end_date' // End date
//           )
//           .where('patients.user_id', userId);
//       // Render the medicine cabinet page with the filtered data
//       res.render("prescription", { medicines });
//   } catch (error) {
//       console.error('Error fetching medicine details:', error);
//       res.status(500).send('Error fetching medicine cabinet data.');
//   }
// });

app.get('/prescription', async (req, res) => {
    try {
        const prescriptions = await knex('prescription')
            .select('full_name', 'medicine_name', 'dosage', 'frequency', 'start_date', 'end_date', 'prescription_id');

        res.render('prescription', { prescriptions: prescriptions }); // Pass it with the exact key
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

// GET route to fetch prescription details and render the edit form
app.get('/edit_prescription/:id', async (req, res) => {
    let id = req.params.id;  // Get the prescription ID from the URL params
    console.log("Requested prescription ID:", id);  // Log the ID to ensure it's correct

    try {
        // Fetch the prescription data from the prescription table
        const prescription = await knex('prescription')
            .select('prescription_id','full_name', 'medicine_name', 'dosage', 'frequency', 'start_date', 'end_date')
            .where('prescription_id', id)  // Assuming prescription_id is the unique identifier
            .first();

        if (!prescription) {
            // If no prescription is found, send a 404 error
            return res.status(404).send('Prescription not found');
        }

        // Render the edit prescription page with the fetched data
        res.render('edit_prescription', { prescription });
    } catch (error) {
        console.error("Error fetching prescription:", error);
        res.status(500).send('Server error');
    }
});

// POST route to handle the form submission and update the prescription
app.post('/edit_prescription/:id', async (req, res) => {
    const { id } = req.params;
    const { full_name, medicine_name, dosage, frequency, start_date, end_date } = req.body;

    try {
        // Update the prescription data in the database
        await knex('prescription')
            .where('prescription_id', id)
            .update({
                full_name,
                medicine_name,
                dosage,
                frequency,
                start_date,
                end_date
            });

        // Redirect back to the list of prescriptions or show a success message
        res.redirect('/prescription');
    } catch (error) {
        console.error("Error updating prescription:", error);
        res.status(500).send('Server error');
    }
});





// add prescription route
app.get("/add_prescription", authMiddleware, async (req, res) => {
    try {
        // Example prescription object
        const prescription = {
            prescription_id: "",
            full_name: "",
            medicine_name: "",
            dosage: "",
            frequency: "",
            start_date: "",
            end_date: ""
        };
        
        res.render("add_prescription", { prescription }); // Pass the prescription object
    } catch (error) {
        console.error('Error loading add prescription page:', error);
        res.status(500).send('Error loading page.');
    }
});

app.post("/add_prescription", async (req, res) => {
    const { full_name, medicine_name, dosage, frequency, start_date, end_date } = req.body;

    try {
        // Insert new prescription data
        await knex("prescription").insert({
            full_name: full_name,
            medicine_name: medicine_name,
            dosage: dosage,
            frequency: frequency,
            start_date: start_date,
            end_date: end_date
        });
        // Redirect after successful insert
        return res.redirect("/prescription");
    } catch (error) {
        console.error("Error adding prescription:", error);
        res.status(500).send("Error adding prescription.");
    }
});



app.get('/delete_prescription/:prescription_id', async (req, res) => {
  const prescription_id = req.params.prescription_id;

  try {
    // Use Knex to delete the event from the database
    await knex('prescription').where('prescription_id', prescription_id).del();
    
    // Redirect to the event manager page after successful deletion
    res.redirect('/prescription');
  } catch (err) {
    console.error("Error deleting prescription:", err);
    
    // Redirect to the event manager page in case of an error (you can add an error message if needed)
    res.redirect('/prescription');
  }
});


//View family
//view
app.get('/family', async (req, res) => {
    const userId = req.session.userId; // Logged-in user's ID
    if (!userId) {
        return res.redirect('/login'); // Redirect if not logged in
    }

    try {
        const patients = await knex('patients')
            .select('*')
            .where('user_id', userId);

        res.render('family', { patients });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

app.get('/delete_patient/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await knex('patients')
            .where('patient_id', id)
            .del();

        res.redirect('/family');
    } catch (error) {
        console.error(error);
        res.status(500).send('Failed to delete patient');
    }
});
//get route to create the page
app.get('/edit_patient/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const patient = await knex('patients')
            .select('*')
            .where('patient_id', id)
            .first();

        if (!patient) {
            return res.status(404).send('Patient not found');
        }

        res.render('edit_patient', { patient });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});
//post route to add the data
app.post('/edit_patient/:id', async (req, res) => {
    const { id } = req.params; // Get the patient ID from the URL
    const { first_name, last_name, phone_number, email, birth_date, allergies } = req.body; // Destructure updated data from the form

    try {
        // Update the patient record in the database
        await knex('patients')
            .where('patient_id', id)
            .update({
                first_name,
                last_name,
                phone_number,
                email,
                birth_date, // Ensure this matches the format in your database (e.g., DATE type)
                allergies,
            });

        // Redirect to the patient list after saving
        res.redirect('/family');
    } catch (error) {
        console.error(error);
        res.status(500).send('Failed to update patient information');
    }
});
app.get('/add_patient', (req, res) => {
    res.render('add_patient');
});


app.post('/add_patient', async (req, res) => {
    const { first_name, last_name, phone_number, email, birth_date, allergies } = req.body;
    const userId = req.session.userId; // Logged-in user's ID

    try {
        await knex('patients').insert({
            user_id: userId,
            first_name,
            last_name,
            phone_number,
            email,
            birth_date, // Ensure proper format (e.g., DATE type in the database)
            allergies
        });

        res.redirect('/family'); // Redirect back to the patient list page
    } catch (error) {
        console.error(error);
        res.status(500).send('Failed to add patient');
    }
});


















// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});



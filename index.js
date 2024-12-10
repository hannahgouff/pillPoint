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

// Medicine Cabinet Page
app.get("/medicine_cabinet", authMiddleware, async (req, res) => {
  try {
      // Fetch the user's ID from the session
      const userId = req.session.userId;

      // Query the database
      const medicines = await knex('medicine')
          .join('dosage', 'medicine.medicine_id', 'dosage.medicine_id') // Join with the dosage table
          .join('patients', 'dosage.patient_id', 'patients.patient_id') // Join with the patients table
          .leftJoin('medicine_description', 'medicine.medicine_id', 'medicine_description.medicine_id') // Join medicine descriptions
          .select(
              'medicine.name',
              'medicine.type',
              'medicine.expiration_date',
              'medicine_description.description',
              'medicine_description.side_effects',
              'medicine_description.warnings'
          )
          .where('patients.user_id', userId);

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
      const medicines = await knex('dosage')
          .join('medicine', 'dosage.medicine_id', 'medicine.medicine_id') // Join with the medicine table
          .join('patients', 'dosage.patient_id', 'patients.patient_id') // Join with the patients table
          .select(
              'patients.first_name', // Patient's first name
              'medicine.name as medicine_name', // Medicine name
              'dosage.dosage', // Dosage
              'dosage.frequency', // Frequency
              'dosage.start_date', // Start date
              'dosage.end_date' // End date
          )
          .where('patients.user_id', userId);
      // Render the medicine cabinet page with the filtered data
      res.render("prescription", { medicines });
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

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

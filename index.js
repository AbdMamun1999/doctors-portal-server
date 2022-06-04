const express = require('express');
const cors = require('cors');
var jwt = require('jsonwebtoken');
require('dotenv').config()
const { MongoClient, ServerApiVersion } = require('mongodb');
const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');

const app = express()
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


function verifYJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    console.log('authheader', authHeader)
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' })
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            console.log(err)
            return res.status(403).send({ message: 'Forbiden access' })

        }
        req.decoded = decoded;
        next()
    });
}

const auth = {
    auth: {
        api_key: 'f23f3049b59fa15be192b03d7a10b03e-27a562f9-af1cac9a',
        domain: 'sandboxe9e07821d0d141de8253ee5cb65004c3.mailgun.org'
    }
}

const nodemailerMailgun = nodemailer.createTransport(mg(auth));

function sendAppointmentEmail(booking) {
    const { patient, patientName, treatment, date, slot } = booking;

    const email = {
        from: 'mamunrox199@gmail.com',
        to: patient,
        subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
        text: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
        html: `
            <div>
                <p>Hello ${patientName},</p>
                <h3>Your Appointment for ${treatment} is confirmed</h3>
                <p>Looking forward to seeing you on ${date} at ${slot} is confirmed</p>

                <h3>Our Address</h3>
                <p>Andor Killa Bandorban</p>
                <p>Bangladesh</p>
                <a href="https://web.programming-hero.com/"></a>
            </div>
        `
    }

    nodemailerMailgun.sendMail(email, (err, info) => {
        console.log(email,'email')
        if (err) {
            console.log(err,'error is mailgun');
        }
        else {
            console.log(info);
        }
    });

}



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.egyhi.mongodb.net/}myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db('doctors-portal').collection('services')
        const bookingCollection = client.db('doctors-portal').collection('bookings')
        const userCollection = client.db('doctors-portal').collection('users')

        // get services
        app.get('/services', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const services = await cursor.toArray();
            res.send(services)

        })

        app.get('/user', async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });


        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user?.role === 'admin';
            res.send({ admin: isAdmin })
        })

        app.put('/user/admin/:email', verifYJWT, async (req, res) => {
            const email = req.params.email
            const requester = req.decoded.email;
            console.log('requester email', email, requester)
            const requesterAccount = await userCollection.findOne({ email: requester })
            if (requesterAccount.role === 'admin') {
                const filter = { email: email }
                const updateDoc = {
                    $set: { role: 'admin' }
                };
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result)
            } else {
                res.status(403).send({ message: 'forbiden' })
            }

        })


        app.put('/user/:email', async (req, res) => {
            const email = req.params.email
            const filter = { email: email }
            const user = req.body
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1d' })
            res.send({ result, token })
        })

        // warning
        // this is not the proper way to query
        // after learning more about mongodb. use aggregate lookup,pipeline,match,group
        app.get('/available', async (req, res) => {
            const date = req.query.date;

            // step 1:  get all services
            const services = await serviceCollection.find().toArray();

            // step 2: get the booking of that day. output: [{}, {}, {}, {}, {}, {}]
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();

            // step 3: for each service
            services.forEach(service => {
                // step 4: find bookings for that service. output: [{}, {}, {}, {}]
                const serviceBookings = bookings.filter(book => book.treatment === service.name);
                // step 5: select slots for the service Bookings: ['', '', '', '']
                const bookedSlots = serviceBookings.map(book => book.slot);
                // step 6: select those slots that are not in bookedSlots
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                //step 7: set available to slots to make it easier 
                service.slots = available;
            });


            res.send(services);
        })


        /**
           * API Naming Convention
           * app.get('/booking') // get all bookings in this collection. or get more than one or by filter
           * app.get('/booking/:id') // get a specific booking 
           * app.post('/booking') // add a new booking
           * app.patch('/booking/:id) //
           * app.put('/booking/:id') // upsert ==> update (if exists) or insert (if doesn't exist)
           * app.delete('/booking/:id) //
          */

        app.get('/booking', verifYJWT, async (req, res) => {
            const patient = req.query.patient;
            console.log('paient', patient)
            const decodedEmail = req.decoded.email;
            console.log('decoded', decodedEmail)
            if (patient === decodedEmail) {
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                res.send(bookings);
            } else {
                res.status(403).send({ message: 'Forbiden access' })
            }
        })

        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = {
                treatment: booking.treatment,
                date: booking.date,
                patient: booking.patient
            }
            const exists = await bookingCollection.findOne(query)
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = bookingCollection.insertOne(booking)
            sendAppointmentEmail(booking);
            return res.send({ success: true, result })
        })


    }
    finally { }
}
run().catch(console.dir)



app.get('/', (req, res) => {
    res.send('getting start')
})

app.listen(port, () => {
    console.log('example app listening on port', port)
})


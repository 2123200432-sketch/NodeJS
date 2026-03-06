import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import morgan from 'morgan';


import authRoutes from './routes/auth.routes.js';
import taskRoutes from './routes/task.routes.js';


const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));


app.get('/', (req, res) => res.json({ok: true, name: 'Alexis'}));
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);

const {PORT = 4000, MONGO_URI} = process.env;
mongoose.connect(process.env.MONGO_URI, {dbName: 'Cluster0'})
    .then(() => {
        console.log('Conectado a mongoDB', mongoose.connection.name);
        app.listen(PORT, () => console.log(`Servidor ejecutandose por: ${PORT}`));
    })
    .catch(err =>{
        console.error('Error conectado a mongoDB', err);
        process.exit(1);
    });
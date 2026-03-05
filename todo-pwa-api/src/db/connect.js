//src/db/conect.js
import mongoose from "mongoose";
 
let cached = global._mongooseConn;
if (!cached)cached = global._mongooseConn = { conn: null, promise: null};

export async function connectToDB(){
    if(cached.conn) return cached.conn;
    if(!cached.promise){
        const {MONGO_URI}= process.env;
        if(!MONGO_URI) throw new Error('Por Favor define la variable de entorno MONGO_URI');
        cached.promise = mongoose.connect(MONGO_URI, {dbName:"Cluster0"})
        .then((m)=> m.connection);

    }

    cached.conn = await cached.promise;
    return cached.conn;
}
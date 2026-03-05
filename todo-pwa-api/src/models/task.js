import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
    {
        user:{type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
        title:{type:String, required: true, trim: true},
        description:{type:String, trim: true, default:''},
        status:{
            type: String,
            enum:['Pendiente',' En progreso', 'completada'],
            default: 'Pendiente',
        },
        clienteId:{trype: String},
        deleted:{type:Boolean, default: false},
    },

);

taskSchema.index({user: 1, clienteId: 1},
    {
        unique: true,
        partialFilterExpression:{ clienteId:{$exists: true, $ne: null, $ne: ''}, deleted:{$ne: true}
    },
    name: 'uniq_user_clienteId',
    background: true
    });
export default mongoose.model('task', taskSchema);
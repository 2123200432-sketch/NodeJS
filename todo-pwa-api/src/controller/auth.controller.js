import User from "../models/user.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export async function register(req, res) {
    try{
        const{name,email,password}= req.body;
        if(!name || !email || !password)
            return res.status(400).json({message: 'Por favor de llenar todos los campos'});
        
        const exist= await User.findOne({email});
        if(exist) return res.status(409).json({message: 'El usuario ya existe carnal'});

        const hash = await bcrypt.hash(password,10);
        const user = new User({name,email,password: hash});
        await user.save();
        const token = jwt.sign({id: user.id,}, process.env.JWT_SECRET || 'changeme',
            {expiresIn: '7d'});

            res.status(201).json({token, user: {id: user.id, name: user.name, email: user.email}});
        
    } catch(e){
        res.status(500).json({message: 'Error en el servidor'});
    }

}
export async function login(req, res){
    try{
        const {email,password} = req.body;
        const user = await User.findOne({email});
        if(!user) return res.status(404).json({message: 'Email o contraseña incorrectos'});

        const ok = await bcrypt.compare(password, user.password);
        if(!ok) return res.status(404).json({message: 'Email o contraseña incorrectos'});

        const token = jwt.sign({id: user.id}, process.env.JWT_SECRET || 'changeme', {expiresIn: '7d'});
        res.json({token, user: {id: user.id, name: user.name, email: user.email} });
    }catch(e){
        res.status(500).json({message: 'Error en el servidor'});
    }
}

export async function profile(req, res){
    const user= await User.findById(req.userId).select('_id name email');
    res.json({user});
}
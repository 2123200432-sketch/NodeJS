import {Router} from "express";
import {register, login , profile } from "../controller/auth.controller.js";
import {auth} from "../middleware/auth.js";

const router = Router();
router.post('/register', register)
router.post('/login', login)
router.get('/profile', auth, profile)

export default router;
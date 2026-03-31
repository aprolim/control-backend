import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  let token;
  
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
      next();
    } catch (error) {
      console.error('Error en auth:', error);
      return res.status(401).json({ message: 'No autorizado' });
    }
  }
  
  if (!token) {
    return res.status(401).json({ message: 'No autorizado, token requerido' });
  }
};

export const jefeOnly = (req, res, next) => {
  if (req.user && req.user.rol === 'jefe') {
    next();
  } else {
    return res.status(403).json({ message: 'Acceso solo para jefes' });
  }
};

export const empleadoOrJefe = (req, res, next) => {
  if (req.user && (req.user.rol === 'empleado' || req.user.rol === 'jefe')) {
    next();
  } else {
    return res.status(403).json({ message: 'Acceso solo para personal' });
  }
};
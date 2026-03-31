import express from 'express';
import Tarjeta from '../models/Tarjeta.js';

const router = express.Router();

// Solicitud pública (sin login)
router.post('/publicas', async (req, res) => {
  try {
    const { titulo, descripcion, clienteInfo } = req.body;
    
    const solicitud = await Tarjeta.create({
      titulo,
      descripcion,
      tipo: 'solicitud_cliente',
      horasEstimadas: 0,
      minutosEstimados: 0,
      prioridad: clienteInfo?.logueado ? 'alta' : 'media',
      clienteInfo: {
        logueado: clienteInfo?.logueado || false,
        nombre: clienteInfo.nombre,
        email: clienteInfo.email || '',
        telefono: clienteInfo.telefono,
        userId: null
      },
      estado: 'pendiente'
    });
    
    res.json({ success: true, message: 'Solicitud enviada exitosamente', id: solicitud._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
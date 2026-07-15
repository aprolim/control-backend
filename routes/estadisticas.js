// routes/estadisticas.js
import express from 'express';
import Tarjeta from '../models/Tarjeta.js';
import User from '../models/User.js';
import { protect, supervisorOnly } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, supervisorOnly, async (req, res) => {
  try {
    const fechaInicio = new Date();
    fechaInicio.setDate(fechaInicio.getDate() - 30);
    
    const tareasPorEstado = await Tarjeta.aggregate([
      { $match: { createdAt: { $gte: fechaInicio } } },
      { $group: { _id: '$estado', count: { $sum: 1 } } }
    ]);
    
    const horasPorDia = await Tarjeta.aggregate([
      { $unwind: '$registroHoras' },
      { $match: { 'registroHoras.fecha': { $gte: fechaInicio } } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$registroHoras.fecha' } },
          totalHoras: { $sum: '$registroHoras.horasTrabajadas' }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    const productividadTecnicos = await Tarjeta.aggregate([
      { $match: { asignadoA: { $ne: null }, estado: 'completada' } },
      { $group: {
          _id: '$asignadoA',
          tareasCompletadas: { $sum: 1 },
          horasTotales: { $sum: '$horasTotalesReales' },
          calificacionPromedio: { $avg: '$calificacion.puntaje' }
        }
      },
      { $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'tecnico'
        }
      }
    ]);
    
    const tareasNocturnas = await Tarjeta.aggregate([
      { $unwind: '$registroHoras' },
      { $match: { 'registroHoras.cruzoMedianoche': true } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$registroHoras.fecha' } },
          count: { $sum: 1 },
          horasExtras: { $sum: '$registroHoras.horasTrabajadas' }
        }
      }
    ]);
    
    const tareasPorTipo = await Tarjeta.aggregate([
      { $match: { createdAt: { $gte: fechaInicio } } },
      { $group: { _id: '$tipo', count: { $sum: 1 } } }
    ]);
    
    const burndown = await Tarjeta.aggregate([
      { $match: { createdAt: { $gte: fechaInicio } } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          nuevas: { $sum: 1 },
          completadas: {
            $sum: { $cond: [{ $eq: ['$estado', 'completada'] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    const toleranciasPendientes = await Tarjeta.aggregate([
      { $unwind: '$tolerancias' },
      { $match: { 'tolerancias.estado': 'pendiente' } },
      { $count: 'total' }
    ]);
    
    res.json({
      tareasPorEstado,
      horasPorDia,
      productividadEmpleados: productividadTecnicos,
      tareasNocturnas,
      tareasPorTipo,
      burndown,
      toleranciasPendientes: toleranciasPendientes[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
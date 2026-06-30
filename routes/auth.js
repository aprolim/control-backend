// routes/auth.js - Login con Zimbra (CON ROLES CORREGIDO)
import express from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import https from 'https';
import User from '../models/User.js';

const router = express.Router();
const ZIMBRA_SERVER = 'https://correo.senado.gob.bo/service/soap';

// ============================================================
// CONFIGURACIÓN: Usuario jefe inicial
// ============================================================
const JEFE_INICIAL_EMAIL = 'grover.plaza@senado.gob.bo';

// ============================================================
// FUNCIÓN: Extraer información del usuario desde XML
// ============================================================
function extraerInfoUsuario(xmlData) {
    let uid = null;
    let nombre = null;
    let email = null;
    let userId = null;

    console.log('📝 Extrayendo información del XML...');

    const uidMatch = xmlData.match(/<attr name="uid">([^<]+)<\/attr>/);
    if (uidMatch) {
        uid = uidMatch[1];
        console.log(`   ✅ uid: ${uid}`);
    } else {
        const uidDirect = xmlData.match(/<uid>([^<]+)<\/uid>/);
        if (uidDirect) {
            uid = uidDirect[1];
            console.log(`   ✅ uid (directo): ${uid}`);
        }
    }

    const displayMatch = xmlData.match(/<attr name="displayName">([^<]+)<\/attr>/);
    if (displayMatch) {
        nombre = displayMatch[1];
        console.log(`   ✅ displayName: ${nombre}`);
    } else {
        const cnMatch = xmlData.match(/<attr name="cn">([^<]+)<\/attr>/);
        if (cnMatch) {
            nombre = cnMatch[1];
            console.log(`   ✅ cn: ${nombre}`);
        }
    }

    const emailMatch = xmlData.match(/<name>([^<]+)<\/name>/);
    if (emailMatch) {
        email = emailMatch[1];
        console.log(`   ✅ email: ${email}`);
        if (!uid) {
            uid = email.split('@')[0];
        }
        if (!nombre) {
            nombre = email;
        }
    }

    const idMatch = xmlData.match(/<id>([^<]+)<\/id>/);
    if (idMatch) {
        userId = idMatch[1];
        console.log(`   ✅ userId: ${userId}`);
    }

    console.log(`📊 Resultado: uid=${uid}, nombre=${nombre}, email=${email}`);
    return { uid, nombre, email, userId };
}

// ============================================================
// FUNCIÓN: Obtener o crear usuario en MongoDB
// ============================================================
async function getOrCreateUser(userInfo, zimbraToken) {
    console.log(`🔍 Buscando usuario: ${userInfo.email}`);
    
    let user = await User.findOne({ email: userInfo.email });

    if (!user && userInfo.uid) {
        user = await User.findOne({ zimbraUid: userInfo.uid });
    }

    if (!user) {
        // Determinar rol: si es el jefe inicial, asignar 'jefe', sino 'cliente'
        const esJefeInicial = userInfo.email === JEFE_INICIAL_EMAIL;
        const rolAsignado = esJefeInicial ? 'jefe' : 'cliente';
        
        console.log(`👤 Creando nuevo usuario... (rol: ${rolAsignado})`);
        user = new User({
            nombre: userInfo.nombre || userInfo.email || 'Usuario Zimbra',
            email: userInfo.email,
            zimbraUid: userInfo.uid,
            zimbraToken: zimbraToken,
            rol: rolAsignado,
            telefono: ''
        });
        await user.save();
        console.log(`✅ Usuario creado: ${user.email} (rol: ${user.rol})`);
    } else {
        console.log(`✅ Usuario existente: ${user.email} (rol: ${user.rol})`);
        // Actualizar datos de Zimbra (sin modificar el rol)
        user.nombre = userInfo.nombre || user.nombre;
        user.zimbraUid = userInfo.uid || user.zimbraUid;
        user.zimbraToken = zimbraToken;
        await user.save();
        console.log(`   ✅ Datos actualizados (rol mantenido: ${user.rol})`);
    }

    return user;
}

// ============================================================
// FUNCIÓN: Generar JWT
// ============================================================
function generateToken(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// ============================================================
// FUNCIÓN: Verificar que no se quede sin jefes
// ============================================================
async function verificarUltimoJefe(userId, nuevoRol) {
    // Si el usuario no es jefe o no se está quitando el rol jefe, no hay problema
    const user = await User.findById(userId);
    if (!user || user.rol !== 'jefe' || nuevoRol === 'jefe') {
        return true;
    }
    
    // Contar cuántos jefes hay (excluyendo al usuario actual)
    const countJefes = await User.countDocuments({ 
        rol: 'jefe', 
        _id: { $ne: userId },
        activo: true 
    });
    
    if (countJefes === 0) {
        throw new Error('No se puede quitar el rol de jefe. Debe haber al menos un jefe en el sistema.');
    }
    
    return true;
}

// ============================================================
// ENDPOINT: Login con Zimbra
// ============================================================
router.post('/login', async (req, res) => {
    const { usuario, password } = req.body;

    console.log('========================================');
    console.log('🔐 [LOGIN] Intentando login Zimbra');
    console.log(`📧 Usuario: ${usuario}`);
    console.log('========================================');

    if (!usuario || !password) {
        console.log('❌ Faltan credenciales');
        return res.status(400).json({
            success: false,
            error: 'Faltan usuario o contraseña'
        });
    }

    try {
        // 1. Construir petición SOAP
        console.log('📤 Construyendo petición SOAP...');
        const authRequest = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
    <soap:Body>
        <AuthRequest xmlns="urn:zimbraAccount">
            <account by="name">${usuario}</account>
            <password>${password}</password>
        </AuthRequest>
    </soap:Body>
</soap:Envelope>`;

        console.log(`🌐 Enviando a: ${ZIMBRA_SERVER}`);
        
        const authResponse = await axios.post(ZIMBRA_SERVER, authRequest, {
            headers: { 'Content-Type': 'application/xml' },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            timeout: 15000
        });

        console.log(`📨 Respuesta recibida (status: ${authResponse.status})`);

        if (authResponse.data.includes('<soap:Fault>')) {
            const faultMatch = authResponse.data.match(/<faultstring>(.*?)<\/faultstring>/);
            const errorMsg = faultMatch ? faultMatch[1] : 'Error de autenticación';
            console.log(`❌ Error SOAP: ${errorMsg}`);
            return res.status(401).json({
                success: false,
                error: 'Credenciales incorrectas',
                mensaje: errorMsg
            });
        }

        const tokenMatch = authResponse.data.match(/<authToken>(.*?)<\/authToken>/);
        if (!tokenMatch) {
            console.log('❌ No se encontró token en la respuesta');
            return res.status(500).json({
                success: false,
                error: 'Error obteniendo token de Zimbra'
            });
        }
        const zimbraToken = tokenMatch[1];
        console.log(`✅ Token obtenido (${zimbraToken.length} caracteres)`);

        console.log('📤 Obteniendo información del usuario...');
        const infoRequest = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
    <soap:Header>
        <context xmlns="urn:zimbra">
            <authToken>${zimbraToken}</authToken>
        </context>
    </soap:Header>
    <soap:Body>
        <GetInfoRequest xmlns="urn:zimbraAccount"/>
    </soap:Body>
</soap:Envelope>`;

        let userInfo = { uid: null, nombre: null, email: null, userId: null };

        try {
            const infoResponse = await axios.post(ZIMBRA_SERVER, infoRequest, {
                headers: { 'Content-Type': 'application/xml' },
                httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                timeout: 15000
            });
            userInfo = extraerInfoUsuario(infoResponse.data);
        } catch (error) {
            console.log('⚠️ Error obteniendo información:', error.message);
            userInfo.uid = usuario.split('@')[0] || usuario;
            userInfo.nombre = usuario;
            userInfo.email = usuario;
        }

        const user = await getOrCreateUser(userInfo, zimbraToken);

        const jwtToken = generateToken(user._id);
        console.log(`✅ JWT generado para: ${user.email} (rol: ${user.rol})`);

        console.log('✅ Login exitoso!');
        console.log('========================================\n');

        res.json({
            success: true,
            _id: user._id,
            nombre: user.nombre,
            email: user.email,
            rol: user.rol,
            telefono: user.telefono || '',
            zimbraUid: user.zimbraUid,
            token: jwtToken,
            zimbraToken: zimbraToken
        });

    } catch (error) {
        console.error('❌ ERROR EN LOGIN:');
        console.error(`   Mensaje: ${error.message}`);
        
        if (error.code === 'ENOTFOUND') {
            console.error('   ⚠️ No se encontró el servidor Zimbra');
            return res.status(500).json({
                success: false,
                error: 'No se pudo conectar al servidor Zimbra',
                mensaje: 'Verifica que el servidor esté accesible'
            });
        }
        
        if (error.code === 'ECONNREFUSED') {
            console.error('   ⚠️ Conexión rechazada por el servidor Zimbra');
            return res.status(500).json({
                success: false,
                error: 'El servidor Zimbra rechazó la conexión',
                mensaje: 'Verifica que el servidor esté funcionando'
            });
        }

        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            console.error(`   Data: ${error.response.data?.substring(0, 200)}`);
        }

        console.error('========================================\n');
        
        res.status(500).json({
            success: false,
            error: 'Error de conexión con el servidor Zimbra',
            mensaje: error.message
        });
    }
});

// ============================================================
// ENDPOINT: Verificar token de Zimbra
// ============================================================
router.post('/verificar', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({
            success: false,
            error: 'No se proporcionó token'
        });
    }

    try {
        const soapRequest = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
    <soap:Body>
        <AuthRequest xmlns="urn:zimbraAccount">
            <authToken>${token}</authToken>
        </AuthRequest>
    </soap:Body>
</soap:Envelope>`;

        const response = await axios.post(ZIMBRA_SERVER, soapRequest, {
            headers: { 'Content-Type': 'application/xml' },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            timeout: 10000
        });

        if (response.data.includes('<soap:Fault>')) {
            return res.status(401).json({
                success: false,
                error: 'Token inválido o expirado'
            });
        }

        res.json({
            success: true,
            mensaje: 'Token válido'
        });

    } catch (error) {
        res.status(401).json({
            success: false,
            error: 'Token inválido o expirado'
        });
    }
});

export default router;
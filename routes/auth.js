// routes/auth.js - Login con Zimbra (VERSIÓN SIMPLIFICADA)
import express from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import https from 'https';
import User from '../models/User.js';

const router = express.Router();
const ZIMBRA_SERVER = 'https://correo.senado.gob.bo/service/soap';

const SUPERVISOR_INICIAL_EMAIL = 'grover.plaza@senado.gob.bo';

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

async function getOrCreateUser(userInfo, zimbraToken) {
    console.log(`🔍 Buscando usuario: ${userInfo.email}`);
    
    let user = await User.findOne({ email: userInfo.email });

    if (!user && userInfo.uid) {
        user = await User.findOne({ zimbraUid: userInfo.uid });
    }

    if (!user) {
        const esSupervisorInicial = userInfo.email === SUPERVISOR_INICIAL_EMAIL;
        const rolAsignado = esSupervisorInicial ? 'supervisor' : 'usuario';
        
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
        user.nombre = userInfo.nombre || user.nombre;
        user.zimbraUid = userInfo.uid || user.zimbraUid;
        user.zimbraToken = zimbraToken;
        await user.save();
        console.log(`   ✅ Datos actualizados (rol mantenido: ${user.rol})`);
    }

    return user;
}

function generateToken(userId) {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

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
            error: 'Faltan credenciales',
            mensaje: 'Por favor ingresa tu usuario y contraseña'
        });
    }

    try {
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
        
        let authResponse;
        try {
            authResponse = await axios.post(ZIMBRA_SERVER, authRequest, {
                headers: { 'Content-Type': 'application/xml' },
                httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                timeout: 15000
            });
        } catch (axiosError) {
            console.log('❌ Error al llamar a Zimbra:');
            
            if (axiosError.response) {
                console.log(`   Status: ${axiosError.response.status}`);
                const responseData = axiosError.response.data || '';
                
                // 🔥 DETECTAR ERROR DE AUTENTICACIÓN (usuario o contraseña incorrectos)
                const isAuthError = responseData.includes('authentication failed') || 
                                   responseData.includes('AUTH_FAILED') ||
                                   responseData.includes('soap:Fault');
                
                if (isAuthError) {
                    console.log('✅ Error de autenticación: usuario o contraseña incorrectos');
                    
                    // 🔥 MENSAJE GENÉRICO Y CLARO
                    return res.status(401).json({
                        success: false,
                        error: 'Credenciales incorrectas',
                        mensaje: 'Usuario o contraseña incorrectos. Por favor verifica tus datos.',
                        detalle: 'Asegúrate de usar tu correo y contraseña de Zimbra.'
                    });
                }
            }
            
            // Error de conexión
            if (axiosError.code === 'ENOTFOUND' || axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ETIMEDOUT') {
                console.log('⚠️ Error de conexión con Zimbra');
                return res.status(503).json({
                    success: false,
                    error: 'Servicio no disponible',
                    mensaje: 'No pudimos conectar con el servidor de autenticación.',
                    detalle: 'Verifica tu conexión de red o intenta más tarde.'
                });
            }
            
            throw axiosError;
        }

        console.log(`📨 Respuesta recibida (status: ${authResponse.status})`);

        // Verificar si hay error SOAP
        const responseData = authResponse.data || '';
        const hasSoapFault = responseData.includes('<soap:Fault>') || 
                            responseData.includes('<SOAP-ENV:Fault>') ||
                            responseData.includes('authentication failed');
        
        if (hasSoapFault) {
            console.log('❌ Error de autenticación detectado en respuesta SOAP');
            
            // 🔥 MENSAJE GENÉRICO Y CLARO
            return res.status(401).json({
                success: false,
                error: 'Credenciales incorrectas',
                mensaje: 'Usuario o contraseña incorrectos. Por favor verifica tus datos.',
                detalle: 'Asegúrate de usar tu correo y contraseña de Zimbra.'
            });
        }

        // Verificar que se recibió un token
        const tokenMatch = responseData.match(/<authToken>(.*?)<\/authToken>/);
        if (!tokenMatch) {
            console.log('❌ No se encontró token en la respuesta');
            return res.status(500).json({
                success: false,
                error: 'Error en el servidor',
                mensaje: 'No se pudo completar la autenticación. Intenta nuevamente.'
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
        console.error('========================================');
        console.error('❌ ERROR EN LOGIN:');
        console.error(`   Mensaje: ${error.message}`);
        console.error(`   Código: ${error.code}`);
        
        if (error.response) {
            console.error(`   Status: ${error.response.status}`);
            const responseData = error.response.data || '';
            
            // Verificar si es error de autenticación
            const isAuthError = responseData.includes('authentication failed') || 
                               responseData.includes('AUTH_FAILED') ||
                               responseData.includes('soap:Fault');
            
            if (isAuthError) {
                console.log('✅ Error de autenticación detectado en catch');
                
                // 🔥 MENSAJE GENÉRICO Y CLARO
                return res.status(401).json({
                    success: false,
                    error: 'Credenciales incorrectas',
                    mensaje: 'Usuario o contraseña incorrectos. Por favor verifica tus datos.',
                    detalle: 'Asegúrate de usar tu correo y contraseña de Zimbra.'
                });
            }
        }
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            console.error('   ⚠️ Error de conexión con Zimbra');
            return res.status(503).json({
                success: false,
                error: 'Servicio no disponible',
                mensaje: 'No pudimos conectar con el servidor de autenticación.',
                detalle: 'Verifica tu conexión de red o intenta más tarde.'
            });
        }

        console.error('========================================\n');
        res.status(500).json({
            success: false,
            error: 'Error del servidor',
            mensaje: 'Ocurrió un error inesperado. Intenta nuevamente.',
            detalle: 'Si el problema persiste, contacta al administrador.'
        });
    }
});

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
@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

title Compilador de Archivos
echo.
echo Compilando archivos...
echo.

set "ARCHIVO_SALIDA=compilado.txt"

:: Eliminar archivo de salida si existe
if exist "%ARCHIVO_SALIDA%" del "%ARCHIVO_SALIDA%"

echo COMPILADO DE ARCHIVOS > "%ARCHIVO_SALIDA%"
echo. >> "%ARCHIVO_SALIDA%"

set ARCHIVOS_PROCESADOS=0

:: Extensiones de imagen a excluir
set "EXTENSIONES_IMAGEN=.jpg .jpeg .png .gif .bmp .tiff .tif .webp .svg .ico .raw .psd .ai .eps"

:: Procesar archivos recursivamente pero excluir node_modules, .git y package-lock.json
for /f "delims=" %%F in ('dir /s /b /a-d * ^| findstr /v /i "\\node_modules\\ \\.git\\ \\.nuxt\\ package-lock\.json"') do (
    if not "%%F"=="%~f0" (
        if not "%%F"=="%CD%\%ARCHIVO_SALIDA%" (
            :: Obtener ruta relativa
            set "ruta_completa=%%F"
            set "ruta_relativa=!ruta_completa:%CD%\=!"
            
            echo Procesando: !ruta_relativa!
            echo. >> "%ARCHIVO_SALIDA%"
            echo ================================= >> "%ARCHIVO_SALIDA%"
            echo !ruta_relativa! >> "%ARCHIVO_SALIDA%"
            echo ================================= >> "%ARCHIVO_SALIDA%"
            echo. >> "%ARCHIVO_SALIDA%"
            
            :: Verificar si es archivo de imagen
            set "es_imagen=0"
            for %%E in (%EXTENSIONES_IMAGEN%) do (
                if /i "%%~xF"=="%%E" set "es_imagen=1"
            )
            
            if !es_imagen!==1 (
                echo [ARCHIVO DE IMAGEN - CONTENIDO NO MOSTRADO] >> "%ARCHIVO_SALIDA%"
            ) else (
                type "%%F" >> "%ARCHIVO_SALIDA%" 2>nul
            )
            
            set /a ARCHIVOS_PROCESADOS+=1
        )
    )
)

echo. >> "%ARCHIVO_SALIDA%"
echo Total archivos: %ARCHIVOS_PROCESADOS% >> "%ARCHIVO_SALIDA%"

echo.
echo ✅ Compilación completada!
echo 📊 Archivos procesados: %ARCHIVOS_PROCESADOS%
echo 💾 Guardado en: %ARCHIVO_SALIDA%
echo.

pause
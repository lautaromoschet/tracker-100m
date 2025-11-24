import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, RefreshCw, MapPin, Activity, Clock, Zap, Sparkles, X, BrainCircuit } from 'lucide-react';

const App = () => {
  // Estados de la aplicación
  const [isTracking, setIsTracking] = useState(false);
  const [totalDistance, setTotalDistance] = useState(0); // Distancia total acumulada en metros
  const [segmentDistance, setSegmentDistance] = useState(0); // Distancia del tramo actual (0 a 100m)
  const [laps, setLaps] = useState([]); // Array de tramos completados
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [gpsAccuracy, setGpsAccuracy] = useState(0);
  const [errorMsg, setErrorMsg] = useState(null);
  
  // Estados para IA (Gemini)
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);

  // Referencias para cálculos sin re-renderizar
  const watchId = useRef(null);
  const lastPosition = useRef(null);
  const segmentStartTime = useRef(null);
  const wakeLock = useRef(null);

  // Constante: Distancia del tramo
  const TARGET_DISTANCE = 100;
  const apiKey = ""; // La API key se inyecta en tiempo de ejecución

  // Función: Fórmula de Haversine para calcular distancia entre dos coordenadas GPS
  const getDistanceFromLatLonInMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Radio de la tierra en metros
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c;
    return d;
  };

  const deg2rad = (deg) => {
    return deg * (Math.PI / 180);
  };

  // Función: Solicitar Wake Lock (Mantener pantalla encendida)
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLock.current = await navigator.wakeLock.request('screen');
      }
    } catch (err) {
      console.log('Wake Lock no soportado o rechazado:', err);
    }
  };

  // Función: Iniciar entrenamiento
  const startTracking = () => {
    if (!navigator.geolocation) {
      setErrorMsg("La geolocalización no es soportada por este navegador.");
      return;
    }

    setIsTracking(true);
    segmentStartTime.current = Date.now();
    requestWakeLock();
    lastPosition.current = null; // Reiniciar última posición conocida
    setErrorMsg(null);
    setAiAnalysis(null); // Limpiar análisis previo al empezar nueva sesión

    const options = {
      enableHighAccuracy: true, // Crucial para medir distancias cortas
      timeout: 5000,
      maximumAge: 0
    };

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed, accuracy } = position.coords;
        setGpsAccuracy(accuracy);
        
        // Si el GPS reporta velocidad, usarla, si no, calcularla
        if (speed !== null) {
            setCurrentSpeed((speed * 3.6).toFixed(1)); // Convertir m/s a km/h
        }

        const now = Date.now();

        if (lastPosition.current) {
          const dist = getDistanceFromLatLonInMeters(
            lastPosition.current.latitude,
            lastPosition.current.longitude,
            latitude,
            longitude
          );

          // Filtrar saltos pequeños del GPS si la precisión es mala (ruido)
          // Solo contamos movimiento si es mayor a 0.5 metros para evitar "caminar estando quieto"
          if (dist > 0.5) {
             // Actualizar estados
             setTotalDistance(prev => prev + dist);
             setSegmentDistance(prev => {
               const newDist = prev + dist;
               
               // CHEQUEO DE CRUCE DE LOS 100 METROS
               if (newDist >= TARGET_DISTANCE) {
                 completeSegment(now);
                 return newDist - TARGET_DISTANCE; // Guardar el remanente para el siguiente tramo
               }
               return newDist;
             });
          }
        }

        lastPosition.current = { latitude, longitude, time: now };
      },
      (error) => {
        let msg = "Error de GPS.";
        switch(error.code) {
            case error.PERMISSION_DENIED: msg = "Permiso de ubicación denegado."; break;
            case error.POSITION_UNAVAILABLE: msg = "Ubicación no disponible."; break;
            case error.TIMEOUT: msg = "Tiempo de espera agotado buscando GPS."; break;
        }
        setErrorMsg(msg);
        stopTracking();
      },
      options
    );
  };

  // Función: Completar un tramo
  const completeSegment = (endTime) => {
    const startTime = segmentStartTime.current;
    const durationMs = endTime - startTime;
    const durationSec = durationMs / 1000;
    
    // Calcular velocidad promedio de ESTE tramo específico
    // Velocidad = Distancia (100m) / Tiempo
    const avgSpeedMs = TARGET_DISTANCE / durationSec;
    const avgSpeedKmh = (avgSpeedMs * 3.6).toFixed(1);

    const newLap = {
      id: Date.now(),
      number: laps.length + 1,
      time: formatTime(durationSec),
      speed: avgSpeedKmh
    };

    // Agregar al inicio de la lista (el más reciente arriba)
    setLaps(prevLaps => [newLap, ...prevLaps]);
    
    // Reiniciar reloj para el siguiente tramo
    segmentStartTime.current = Date.now();
  };

  // Función: Llamar a Gemini API
  const analyzePerformance = async () => {
    if (laps.length === 0) return;
    
    setIsAnalyzing(true);
    setErrorMsg(null);

    // Preparar datos para el prompt
    // Invertimos laps para que el orden sea cronológico (1, 2, 3...) en el prompt
    const chronologicalLaps = [...laps].reverse();
    const lapsData = chronologicalLaps.map(l => `Serie ${l.number}: ${l.time} (${l.speed} km/h)`).join('\n');
    
    const prompt = `Actúa como un entrenador de atletismo de clase mundial. 
    Aquí están mis tiempos recientes en series de 100 metros:\n${lapsData}\n\n
    Analiza mi rendimiento brevemente (máximo 60 palabras). 
    1. Dime si fui consistente o si mi rendimiento decayó por fatiga.
    2. Dame UN consejo técnico específico para mejorar mi velocidad.
    3. Termina con una frase muy motivadora.
    Responde en español, usa emojis y sé directo.`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      );

      if (!response.ok) throw new Error('Error al conectar con el entrenador IA');

      const data = await response.json();
      const analysisText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No pude analizar tus datos en este momento.";
      
      setAiAnalysis(analysisText);
      setShowAnalysisModal(true);
    } catch (error) {
      console.error(error);
      setErrorMsg("No se pudo conectar con el Coach IA. Verifica tu conexión.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Función: Detener entrenamiento
  const stopTracking = () => {
    if (watchId.current) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (wakeLock.current) {
      wakeLock.current.release().then(() => {
        wakeLock.current = null;
      });
    }
    setIsTracking(false);
  };

  // Función: Reiniciar todo
  const resetAll = () => {
    stopTracking();
    setTotalDistance(0);
    setSegmentDistance(0);
    setLaps([]);
    setCurrentSpeed(0);
    setAiAnalysis(null);
    lastPosition.current = null;
    segmentStartTime.current = null;
  };

  // Formatear segundos a mm:ss.ms
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // Función de prueba manual
  const manualAddDistance = () => {
    if (!isTracking) return;
    const fakeDist = 10; 
    const now = Date.now();
    setTotalDistance(prev => prev + fakeDist);
    setSegmentDistance(prev => {
        const newDist = prev + fakeDist;
        if (newDist >= TARGET_DISTANCE) {
            completeSegment(now);
            return newDist - TARGET_DISTANCE;
        }
        return newDist;
    });
  };

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 font-sans overflow-hidden relative">
      
      {/* Modal de Análisis de IA */}
      {showAnalysisModal && (
        <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-800 w-full max-w-md rounded-2xl border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="bg-gradient-to-r from-violet-600 to-indigo-600 p-4 flex justify-between items-center">
                <div className="flex items-center gap-2 text-white font-bold">
                    <BrainCircuit size={20} className="text-violet-200" />
                    <span>Entrenador Gemini</span>
                </div>
                <button onClick={() => setShowAnalysisModal(false)} className="text-white/80 hover:text-white">
                    <X size={24} />
                </button>
            </div>
            <div className="p-6 overflow-y-auto text-slate-200 leading-relaxed whitespace-pre-wrap">
                {aiAnalysis}
            </div>
            <div className="p-4 bg-slate-900 border-t border-slate-800">
                <button 
                    onClick={() => setShowAnalysisModal(false)}
                    className="w-full py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-semibold text-white transition-colors"
                >
                    ¡Entendido, a correr!
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center shadow-md z-10">
        <div className="flex items-center gap-2">
            <Activity className="text-emerald-400" size={24} />
            <h1 className="text-xl font-bold text-white tracking-wide">100m Tracker</h1>
        </div>
        <div className={`text-xs px-2 py-1 rounded-full ${gpsAccuracy > 20 ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
           GPS: ±{Math.round(gpsAccuracy)}m
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        
        {/* Error Message */}
        {errorMsg && (
            <div className="bg-red-500/20 border border-red-500/50 p-3 rounded-lg text-red-200 text-sm text-center">
                {errorMsg}
            </div>
        )}

        {/* Big Metrics Display */}
        <div className="grid grid-cols-2 gap-3">
            {/* Tarjeta Distancia Total */}
            <div className="bg-slate-800 p-4 rounded-2xl flex flex-col items-center justify-center border border-slate-700 shadow-sm">
                <span className="text-slate-400 text-xs uppercase tracking-wider mb-1">Total</span>
                <span className="text-3xl font-mono font-bold text-white">
                    {(totalDistance / 1000).toFixed(2)} <span className="text-sm text-slate-500">km</span>
                </span>
            </div>

            {/* Tarjeta Velocidad Actual */}
            <div className="bg-slate-800 p-4 rounded-2xl flex flex-col items-center justify-center border border-slate-700 shadow-sm">
                <span className="text-slate-400 text-xs uppercase tracking-wider mb-1">Actual</span>
                <span className="text-3xl font-mono font-bold text-emerald-400">
                    {currentSpeed} <span className="text-sm text-slate-500">km/h</span>
                </span>
            </div>
        </div>

        {/* Barra de Progreso del Tramo (0-100m) */}
        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg relative overflow-hidden">
            <div className="flex justify-between items-end mb-2 relative z-10">
                <span className="text-slate-400 text-sm font-medium">Progreso del tramo</span>
                <span className="text-4xl font-black text-white italic">
                    {Math.floor(segmentDistance)}<span className="text-xl text-slate-500 font-normal">m</span>
                </span>
            </div>
            
            {/* Progress Bar Background */}
            <div className="h-4 w-full bg-slate-700 rounded-full overflow-hidden">
                <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300 ease-out"
                    style={{ width: `${(segmentDistance / TARGET_DISTANCE) * 100}%` }}
                />
            </div>
            <div className="flex justify-between mt-1 text-xs text-slate-500 font-mono">
                <span>0m</span>
                <span>100m</span>
            </div>
        </div>

        {/* Header Lista de Laps + Botón IA */}
        <div className="flex items-center justify-between mt-2">
             <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider px-1">Historial</h3>
             
             {laps.length > 0 && !isTracking && (
                <button 
                    onClick={analyzePerformance}
                    disabled={isAnalyzing}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 rounded-lg text-xs font-bold text-white shadow-lg shadow-violet-500/20 active:scale-95 transition-transform disabled:opacity-50"
                >
                    {isAnalyzing ? (
                        <>
                            <RefreshCw size={12} className="animate-spin" />
                            <span>Analizando...</span>
                        </>
                    ) : (
                        <>
                            <Sparkles size={12} className="text-yellow-200" />
                            <span>Analizar ✨</span>
                        </>
                    )}
                </button>
             )}
        </div>

        {/* Lista de Laps / Tramos */}
        <div className="flex-1">
            {laps.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-slate-600 gap-2 border-2 border-dashed border-slate-800 rounded-xl mt-2">
                    <MapPin size={32} />
                    <p>Inicia para registrar tramos</p>
                </div>
            ) : (
                <div className="flex flex-col gap-2 pb-20 mt-2">
                    {laps.map((lap) => (
                        <div key={lap.id} className="bg-slate-800 p-4 rounded-xl border-l-4 border-emerald-500 flex justify-between items-center shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-300">
                            <div className="flex flex-col">
                                <span className="text-xs text-slate-400 uppercase font-bold">Tramo {lap.number}</span>
                                <div className="flex items-center gap-2 mt-1">
                                    <Clock size={14} className="text-slate-500" />
                                    <span className="text-xl font-mono text-white font-bold">{lap.time}</span>
                                </div>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-xs text-slate-400">Promedio</span>
                                <div className="flex items-center gap-1">
                                    <Zap size={14} className="text-yellow-500" />
                                    <span className="text-lg font-bold text-slate-200">{lap.speed} <span className="text-xs font-normal">km/h</span></span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </main>

      {/* Controls Footer */}
      <footer className="bg-slate-900/90 backdrop-blur-sm p-6 pb-8 border-t border-slate-800 fixed bottom-0 w-full flex justify-center gap-6 z-20">
        {!isTracking ? (
            <>
                <button 
                    onClick={resetAll}
                    disabled={totalDistance === 0}
                    className="flex flex-col items-center justify-center gap-1 text-slate-400 active:text-white disabled:opacity-30 transition-colors"
                >
                    <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
                        <RefreshCw size={20} />
                    </div>
                    <span className="text-xs font-medium">Reset</span>
                </button>

                <button 
                    onClick={startTracking}
                    className="flex flex-col items-center gap-2 group"
                >
                    <div className="w-20 h-20 rounded-full bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)] flex items-center justify-center text-slate-900 group-active:scale-95 transition-all">
                        <Play size={36} fill="currentColor" className="ml-1" />
                    </div>
                    <span className="text-sm font-bold text-emerald-400 uppercase tracking-widest">Iniciar</span>
                </button>
            </>
        ) : (
            <>
                 <button 
                    onClick={stopTracking}
                    className="flex flex-col items-center gap-2 group"
                >
                    <div className="w-20 h-20 rounded-full bg-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.3)] flex items-center justify-center text-white group-active:scale-95 transition-all">
                        <Square size={32} fill="currentColor" />
                    </div>
                    <span className="text-sm font-bold text-rose-400 uppercase tracking-widest" onDoubleClick={manualAddDistance}>Detener</span>
                </button>
            </>
        )}
      </footer>
    </div>
  );
};

export default App;
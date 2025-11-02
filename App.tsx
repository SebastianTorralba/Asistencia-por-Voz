import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import type { AttendanceRecord } from './types';

// Helper to convert Blob to Base64
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // result is "data:audio/webm;base64,...."
            // we only need the part after the comma
            const base64String = (reader.result as string).split(',')[1];
            resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

const MicrophoneIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM10.5 5a1.5 1.5 0 0 1 3 0v6a1.5 1.5 0 0 1-3 0V5Z" />
        <path d="M12 16.5A4.5 4.5 0 0 1 7.5 12H6a6 6 0 0 0 5.25 5.955V21h1.5v-3.045A6 6 0 0 0 18 12h-1.5a4.5 4.5 0 0 1-4.5 4.5Z" />
    </svg>
);

const StopIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M4.5 7.5a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9Z" clipRule="evenodd" />
    </svg>
);

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M12 2.25a.75.75 0 0 1 .75.75v11.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 1 1 1.06-1.06l3.22 3.22V3a.75.75 0 0 1 .75-.75Zm-9 13.5a.75.75 0 0 1 .75.75v2.25a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5V16.5a.75.75 0 0 1 1.5 0v2.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V16.5a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" />
    </svg>
);

const AttendanceTable: React.FC<{ records: AttendanceRecord[]; caption: string }> = ({ records, caption }) => {
    return (
        <div className="overflow-x-auto rounded-lg shadow-lg bg-gray-800 border border-gray-700">
            <table className="w-full text-left">
                <caption className="sr-only">{caption}</caption>
                <thead className="bg-gray-700">
                    <tr>
                        <th scope="col" className="p-4 text-sm font-semibold tracking-wider text-gray-300">Nombre</th>
                        <th scope="col" className="p-4 text-sm font-semibold tracking-wider text-gray-300">Estado</th>
                        <th scope="col" className="p-4 text-sm font-semibold tracking-wider text-gray-300">Fecha</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-600">
                    {records.map((record, index) => (
                        <tr key={index} className="hover:bg-gray-700 transition-colors duration-200">
                            <td className="p-4 whitespace-nowrap">{record.name}</td>
                            <td className="p-4 whitespace-nowrap">
                                <span className={`px-3 py-1 text-xs font-semibold rounded-full ${record.status === 'Presente'
                                        ? 'bg-green-600/30 text-green-300 border border-green-500'
                                        : 'bg-red-600/30 text-red-300 border border-red-500'
                                    }`}>
                                    {record.status}
                                </span>
                            </td>
                            <td className="p-4 whitespace-nowrap text-gray-400">{record.date}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

type Step = 'idle' | 'recording' | 'recorded' | 'transcribing' | 'transcribed' | 'generating' | 'done';

const LOCAL_STORAGE_KEY = 'attendanceRecords';

export default function App() {
    const [step, setStep] = useState<Step>('idle');
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [transcription, setTranscription] = useState<string>('');
    const [attendanceList, setAttendanceList] = useState<AttendanceRecord[]>([]);
    const [error, setError] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    useEffect(() => {
        try {
            const savedRecordsJSON = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (savedRecordsJSON) {
                const savedRecords = JSON.parse(savedRecordsJSON);
                if (Array.isArray(savedRecords) && savedRecords.length > 0) {
                    setAttendanceList(savedRecords);
                    setStep('done');
                }
            }
        } catch (e) {
            console.error("Failed to load or parse attendance records from localStorage.", e);
            localStorage.removeItem(LOCAL_STORAGE_KEY);
        }
    }, []);

    const resetState = () => {
        setStep('idle');
        setAudioBlob(null);
        setTranscription('');
        setAttendanceList([]);
        setError(null);
        audioChunksRef.current = [];
        try {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
        } catch (e) {
            console.error("Failed to remove attendance records from localStorage.", e);
        }
    };

    const startRecording = async () => {
        resetState();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            
            mediaRecorderRef.current.ondataavailable = (event) => {
                audioChunksRef.current.push(event.data);
            };

            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                setAudioBlob(blob);
                setStep('recorded');
                audioChunksRef.current = [];
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorderRef.current.start();
            setStep('recording');
        } catch (e) {
            console.error(e);
            setError("No se pudo acceder al micrófono. Por favor, revisá los permisos.");
            setStep('idle');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        }
    };

    const handleTranscribe = async () => {
        if (!audioBlob) return;
        setStep('transcribing');
        setError(null);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const base64Audio = await blobToBase64(audioBlob);

            const audioPart = {
                inlineData: {
                    mimeType: audioBlob.type,
                    data: base64Audio,
                },
            };

            const textPart = { text: "Transcribí este audio a texto. El audio contiene una lista de asistencia." };

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [audioPart, textPart] },
            });
            
            const transcript = response.text;
            if (!transcript.trim()) {
                setError("La transcripción está vacía. Por favor, intentá grabar de nuevo.");
                setStep('recorded');
                return;
            }
            setTranscription(transcript);
            setStep('transcribed');
        } catch (e) {
            console.error(e);
            setError("Hubo un error al transcribir el audio. Por favor, intentá de nuevo.");
            setStep('recorded');
        }
    };

    const handleGenerateList = async () => {
        if (!transcription.trim()) return;
        setStep('generating');
        setError(null);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const today = new Date().toISOString().split('T')[0];
            const prompt = `Analizá el siguiente texto de una lista de asistencia. La regla es: después de que se dice un nombre, se tiene que escuchar "presente" en aproximadamente 2 segundos. Si no pasa eso, la persona está "Ausente". Como estás procesando texto, interpretá la distancia entre palabras como si fuera el tiempo. Si un nombre es seguido de cerca por "presente", marcá a la persona como 'Presente'. Si después de un nombre hay una pausa implícita (indicada por otros nombres o una distancia considerable en el texto antes del siguiente "presente") o si la grabación termina, marcá a esa persona como 'Ausente'. Devolvé un array JSON de objetos para cada persona mencionada. Cada objeto debe tener 'name' (string), 'status' ('Presente' o 'Ausente'), y 'date' (string, con el valor '${today}'). Texto: "${transcription}"`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING, description: 'Nombre de la persona' },
                                status: { type: Type.STRING, description: 'Estado: "Presente" o "Ausente"' },
                                date: { type: Type.STRING, description: `Fecha en formato AAAA-MM-DD, usar ${today}` }
                            },
                            required: ['name', 'status', 'date']
                        }
                    }
                },
            });

            const jsonString = response.text.trim();
            const result = JSON.parse(jsonString);
            setAttendanceList(result);
            try {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(result));
            } catch (e) {
                console.error("Failed to save attendance records to localStorage.", e);
            }
            setStep('done');
        } catch (e) {
            console.error(e);
            setError("Hubo un error al procesar la transcripción. Por favor, intentá de nuevo.");
            setStep('transcribed');
        }
    };
    
    const exportToCSV = () => {
        if (attendanceList.length === 0) return;
        const headers = ['Nombre', 'Estado', 'Fecha'];
        const escapeCSV = (field: string) => `"${String(field).replace(/"/g, '""')}"`;
        const csvRows = [
            headers.join(','),
            ...attendanceList.map(record =>
                [escapeCSV(record.name), escapeCSV(record.status), escapeCSV(record.date)].join(',')
            )
        ];
        const csvContent = csvRows.join('\n');
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const today = new Date().toISOString().split('T')[0];
        link.setAttribute('href', url);
        link.setAttribute('download', `asistencia-${today}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const isLoading = step === 'transcribing' || step === 'generating';

    return (
        <div role="main" className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center justify-center p-4 font-sans">
            <div className="w-full max-w-2xl text-center space-y-8">
                <div>
                    <h1 className="text-4xl md:text-5xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500">
                        Asistencia por Voz
                    </h1>
                    <p className="text-gray-400">
                        Tomá asistencia en 3 simples pasos: grabá, transcribí y generá la lista final.
                    </p>
                </div>

                {error && <div role="alert" aria-live="assertive" className="bg-red-500/20 border border-red-500 text-red-300 p-3 rounded-md">{error}</div>}

                {(step === 'idle' || step === 'recording') && (
                     <div className="flex justify-center">
                        <button
                            onClick={step === 'idle' ? startRecording : stopRecording}
                            aria-label={step === 'recording' ? 'Detener la grabación' : 'Empezar a grabar'}
                            aria-pressed={step === 'recording'}
                            className={`relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-300 ease-in-out shadow-lg
                                ${step === 'recording' ? 'bg-red-500 hover:bg-red-600' : 'bg-cyan-500 hover:bg-cyan-600'}
                                focus:outline-none focus:ring-4 ${step === 'recording' ? 'focus:ring-red-500/50' : 'focus:ring-cyan-500/50'}`}
                        >
                            {step === 'recording' && <span className="absolute h-full w-full rounded-full bg-red-500 animate-ping opacity-75" aria-hidden="true"></span>}
                            {step === 'recording' ? <StopIcon className="w-10 h-10 text-white" /> : <MicrophoneIcon className="w-10 h-10 text-white" />}
                        </button>
                    </div>
                )}
                
                {step === 'recorded' && audioBlob && (
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 space-y-4" aria-labelledby="recording-heading">
                        <h3 id="recording-heading" className="text-lg font-semibold text-cyan-300">Grabación completa</h3>
                        <audio src={URL.createObjectURL(audioBlob)} controls className="w-full" aria-label="Reproductor de audio con la grabación para la asistencia" />
                        <div className="flex justify-center gap-4">
                            <button onClick={resetState} className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700/50 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors" aria-label="Descartar la grabación actual y empezar de nuevo">Grabar de Nuevo</button>
                            <button onClick={handleTranscribe} className="px-6 py-2 text-sm font-medium text-white bg-cyan-500 rounded-lg hover:bg-cyan-600 transition-colors" aria-label="Transcribir el audio grabado para convertirlo a texto">Transcribir Audio</button>
                        </div>
                    </div>
                )}
                
                {step === 'transcribed' && (
                     <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 space-y-4 text-left" aria-labelledby="transcription-heading">
                        <h3 id="transcription-heading" className="text-lg font-semibold text-cyan-300">Transcripción</h3>
                        <p className="text-gray-300 whitespace-pre-wrap bg-gray-900/50 p-3 rounded-md">{transcription}</p>
                         <div className="flex justify-center">
                            <button onClick={handleGenerateList} className="px-6 py-2 text-sm font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition-colors" aria-label="Analizar la transcripción y generar la lista final de asistencia">Generar Lista de Asistencia</button>
                         </div>
                    </div>
                )}

                {isLoading && (
                    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center">
                        <div className="w-12 h-12 border-4 border-t-transparent border-cyan-400 rounded-full animate-spin" aria-hidden="true"></div>
                        <p className="mt-4 text-cyan-300">{step === 'transcribing' ? 'Transcribiendo audio...' : 'Analizando la asistencia...'}</p>
                    </div>
                )}

                {step === 'done' && attendanceList.length > 0 && (
                    <div className="w-full max-w-2xl text-left space-y-4">
                        <div className="flex justify-between items-center">
                            <h2 className="text-xl font-semibold text-cyan-300">Resultados de la Asistencia</h2>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={exportToCSV}
                                    aria-label="Exportar la lista de asistencia como un archivo CSV"
                                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-cyan-200 bg-gray-700/50 border border-gray-600 rounded-lg hover:bg-gray-700 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                >
                                    <DownloadIcon className="w-4 h-4" />
                                    <span>Exportar a CSV</span>
                                </button>
                                <button onClick={resetState} className="px-4 py-2 text-sm font-medium text-white bg-cyan-600 rounded-lg hover:bg-cyan-700 transition-colors" aria-label="Borrar la lista de asistencia actual y empezar de nuevo">Empezar de Nuevo</button>
                            </div>
                        </div>
                        <AttendanceTable records={attendanceList} caption="Tabla con los resultados de la asistencia" />
                    </div>
                )}
            </div>
        </div>
    );
}

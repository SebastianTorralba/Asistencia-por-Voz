import React, { useState, useRef, useCallback } from 'react';
// FIX: The 'LiveSession' type is not exported from the '@google/genai' package.
import { GoogleGenAI, Modality, Type, Blob } from '@google/genai';
import type { AttendanceRecord } from './types';

// Helper function to encode raw audio data to base64
function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// FIX: Added decode and decodeAudioData functions to handle audio output from the model, as required by the guidelines.
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


const MicrophoneIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM10.5 5a1.5 1.5 0 0 1 3 0v6a1.5 1.5 0 0 1-3 0V5Z" />
    <path d="M12 16.5A4.5 4.5 0 0 1 7.5 12H6a6 6 0 0 0 5.25 5.955V21h1.5v-3.045A6 6 0 0 0 18 12h-1.5a4.5 4.5 0 0 1-4.5 4.5Z" />
  </svg>
);

const StopIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" d="M4.5 7.5a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9Z" clipRule="evenodd" />
  </svg>
);

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" d="M12 2.25a.75.75 0 0 1 .75.75v11.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 1 1 1.06-1.06l3.22 3.22V3a.75.75 0 0 1 .75-.75Zm-9 13.5a.75.75 0 0 1 .75.75v2.25a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5V16.5a.75.75 0 0 1 1.5 0v2.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V16.5a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" />
    </svg>
);

const AttendanceTable: React.FC<{ records: AttendanceRecord[] }> = ({ records }) => {
  return (
    <div className="overflow-x-auto rounded-lg shadow-lg bg-gray-800 border border-gray-700">
      <table className="w-full text-left">
        <thead className="bg-gray-700">
          <tr>
            <th className="p-4 text-sm font-semibold tracking-wider text-gray-300">Nombre</th>
            <th className="p-4 text-sm font-semibold tracking-wider text-gray-300">Estado</th>
            <th className="p-4 text-sm font-semibold tracking-wider text-gray-300">Fecha</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-600">
          {records.map((record, index) => (
            <tr key={index} className="hover:bg-gray-700 transition-colors duration-200">
              <td className="p-4 whitespace-nowrap">{record.name}</td>
              <td className="p-4 whitespace-nowrap">
                <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                  record.status === 'Presente'
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


export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState('');
  const [attendanceList, setAttendanceList] = useState<AttendanceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  // FIX: Replaced 'LiveSession' with 'any' as it's not an exported type.
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  // FIX: Added refs for handling audio output.
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());


  const processTranscription = useCallback(async (transcription: string) => {
    if (!transcription.trim()) {
      setError("La transcripción está vacía. No se pudo procesar.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
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
      setAttendanceList(prevList => [...prevList, ...result]);
    } catch (e) {
      console.error(e);
      setError("Hubo un error al procesar la transcripción. Por favor, intentá de nuevo.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().then(() => { audioContextRef.current = null; });
    }
    // FIX: Added cleanup for output audio resources.
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
      outputAudioContextRef.current.close().then(() => { outputAudioContextRef.current = null; });
    }
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => session.close());
        sessionPromiseRef.current = null;
    }
  }, []);


  const startRecording = async () => {
    setIsRecording(true);
    setIsLoading(false);
    setError(null);
    setLiveTranscription('');
    let finalTranscription = '';
    
    // FIX: Initialize output audio context.
    if (!outputAudioContextRef.current) {
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }


    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            console.log('Session opened.');
            // FIX: Cast window to `any` to support `webkitAudioContext` for older browsers.
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const source = audioContextRef.current.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              
              if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then((session) => {
                    session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current.destination);
          },
          onmessage: async (message) => {
            if (message.serverContent?.inputTranscription) {
                const text = message.serverContent.inputTranscription.text;
                setLiveTranscription(prev => prev + text);
                finalTranscription += text;
            }

            // FIX: Added audio output handling to comply with API guidelines.
            const base64EncodedAudioString =
              message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
            if (base64EncodedAudioString && outputAudioContextRef.current) {
              const outputAudioContext = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(
                nextStartTimeRef.current,
                outputAudioContext.currentTime,
              );
              const audioBuffer = await decodeAudioData(
                decode(base64EncodedAudioString),
                outputAudioContext,
                24000,
                1,
              );
              const source = outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputAudioContext.destination);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current = nextStartTimeRef.current + audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(source => source.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }

            if (message.serverContent?.turnComplete) {
                console.log('Turn complete.');
                stopRecording();
                processTranscription(finalTranscription);
            }
          },
          onerror: (e) => {
            console.error('Session error:', e);
            setError("Hubo un error en la conexión. Por favor, recargá la página.");
            stopRecording();
          },
          onclose: (e) => {
            console.log('Session closed.');
          },
        },
        config: {
          inputAudioTranscription: {},
          responseModalities: [Modality.AUDIO],
        },
      });

    } catch (e) {
      console.error(e);
      setError("No se pudo acceder al micrófono. Por favor, revisá los permisos.");
      setIsRecording(false);
    }
  };

  const handleRecordButtonClick = () => {
    if (isRecording) {
      stopRecording();
      // Wait a moment for final transcription parts to arrive before processing.
      // The `turnComplete` event is the main trigger, but this is a fallback.
      setTimeout(() => {
        if (!isLoading) {
             processTranscription(liveTranscription);
        }
      }, 1000);
    } else {
      startRecording();
    }
  };
  
  const exportToCSV = () => {
    if (attendanceList.length === 0) return;

    const headers = ['Nombre', 'Estado', 'Fecha'];
    // Helper to wrap fields in quotes and escape existing quotes
    const escapeCSV = (field: string) => `"${String(field).replace(/"/g, '""')}"`;

    const csvRows = [
      headers.join(','), // header row
      ...attendanceList.map(record => 
        [
          escapeCSV(record.name),
          escapeCSV(record.status),
          escapeCSV(record.date)
        ].join(',')
      )
    ];

    const csvContent = csvRows.join('\n');
    // Adding BOM for better Excel compatibility with UTF-8 characters
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const today = new Date().toISOString().split('T')[0];
    
    link.setAttribute('href', url);
    link.setAttribute('download', `asistencia-${today}.csv`);
    document.body.appendChild(link); // Required for Firefox
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setAttendanceList([]); // Clear the list after exporting
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-2xl text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500">
          Asistencia por Voz
        </h1>
        <p className="text-gray-400 mb-8">
          Grabá los nombres y quiénes dan el presente. La lista se irá acumulando. Cuando termines, exportala a CSV.
        </p>

        <div className="flex justify-center mb-8">
          <button
            onClick={handleRecordButtonClick}
            disabled={isLoading}
            className={`relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-300 ease-in-out shadow-lg
              ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-cyan-500 hover:bg-cyan-600'}
              ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
              focus:outline-none focus:ring-4 ${isRecording ? 'focus:ring-red-500/50' : 'focus:ring-cyan-500/50'}`}
          >
            {isRecording && <span className="absolute h-full w-full rounded-full bg-red-500 animate-ping opacity-75"></span>}
            {isRecording ? <StopIcon className="w-10 h-10 text-white" /> : <MicrophoneIcon className="w-10 h-10 text-white" />}
          </button>
        </div>

        {error && <div className="bg-red-500/20 border border-red-500 text-red-300 p-3 rounded-md mb-6">{error}</div>}

        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 min-h-[150px] w-full max-w-2xl text-left">
          <h3 className="text-lg font-semibold mb-2 text-cyan-300">Transcripción en Vivo</h3>
          {isRecording && !liveTranscription && <p className="text-gray-500 animate-pulse">Escuchando...</p>}
          <p className="text-gray-300 whitespace-pre-wrap">{liveTranscription}</p>
        </div>
        
        {isLoading && (
            <div className="mt-8 flex flex-col items-center justify-center">
                <div className="w-12 h-12 border-4 border-t-transparent border-cyan-400 rounded-full animate-spin"></div>
                <p className="mt-4 text-cyan-300">Analizando la asistencia...</p>
            </div>
        )}

        {attendanceList.length > 0 && !isLoading && (
          <div className="w-full max-w-2xl mt-8 text-left">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-cyan-300">Resultados de la Asistencia</h2>
              <button 
                onClick={exportToCSV}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-cyan-200 bg-gray-700/50 border border-gray-600 rounded-lg hover:bg-gray-700 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                <DownloadIcon className="w-4 h-4" />
                <span>Exportar y Limpiar</span>
              </button>
            </div>
            <AttendanceTable records={attendanceList} />
          </div>
        )}
      </div>
    </div>
  );
}

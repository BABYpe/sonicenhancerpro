import React, { useRef, useState, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Upload, Play, Pause, Volume2, VolumeX, Download, Wand2, Mic, Volume as VolumeUp, Volume1, Waves, Sliders, RefreshCw, Zap } from 'lucide-react';
import * as Meyda from 'meyda';
import { PitchDetector } from 'pitchy';

function App() {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [sourceNode, setSourceNode] = useState<AudioBufferSourceNode | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [voiceBoostLevel, setVoiceBoostLevel] = useState(1.2);
  const [volumeLevel, setVolumeLevel] = useState(1.0);
  const [clarityLevel, setClarityLevel] = useState(1.0);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [noiseReductionLevel, setNoiseReductionLevel] = useState(0.5);
  const [pitchCorrection, setPitchCorrection] = useState(0);
  const [autoLevel, setAutoLevel] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [processingTime, setProcessingTime] = useState<number | null>(null);

  useEffect(() => {
    if (waveformRef.current) {
      wavesurfer.current = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: 'rgb(124, 58, 237)',
        progressColor: 'rgb(139, 92, 246)',
        cursorColor: '#C7D2FE',
        barWidth: 2,
        barRadius: 3,
        cursorWidth: 1,
        height: 100,
        barGap: 3,
        normalize: true,
        responsive: true,
      });

      wavesurfer.current.on('play', () => setIsPlaying(true));
      wavesurfer.current.on('pause', () => setIsPlaying(false));

      return () => {
        wavesurfer.current?.destroy();
      };
    }
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && wavesurfer.current) {
      wavesurfer.current.loadBlob(file);
      const ctx = new AudioContext();
      setAudioContext(ctx);
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      setSourceNode(source);
      
      if (autoLevel) {
        analyzeAndSetLevels(audioBuffer);
      }
    }
  };

  const analyzeAndSetLevels = async (buffer: AudioBuffer) => {
    setProcessingStatus('Analyzing audio characteristics...');
    const detector = PitchDetector.forFloat32Array(buffer.length);
    const channelData = buffer.getChannelData(0);
    const [pitch] = detector.findPitch(channelData, buffer.sampleRate);

    let sum = 0;
    for (let i = 0; i < channelData.length; i++) {
      sum += Math.abs(channelData[i]);
    }
    const avgVolume = sum / channelData.length;

    setVolumeLevel(Math.min(2.0, 1.0 / avgVolume));
    setPitchCorrection(pitch > 0 ? Math.log2(440 / pitch) : 0);
    setNoiseReductionLevel(Math.min(0.9, avgVolume * 2));
    setClarityLevel(Math.min(2.0, 1.5 / avgVolume));
    
    setProcessingStatus('Auto-levels optimized for best quality');
  };

  const togglePlayPause = () => {
    if (wavesurfer.current) {
      wavesurfer.current.playPause();
    }
  };

  const toggleMute = () => {
    if (wavesurfer.current) {
      wavesurfer.current.setMuted(!isMuted);
      setIsMuted(!isMuted);
    }
  };

  const toggleAutoLevel = () => {
    setAutoLevel(!autoLevel);
    if (!autoLevel && sourceNode?.buffer) {
      analyzeAndSetLevels(sourceNode.buffer);
    }
  };

  const adjustPlaybackSpeed = () => {
    const newSpeed = playbackSpeed >= 2 ? 0.5 : playbackSpeed + 0.5;
    setPlaybackSpeed(newSpeed);
    if (wavesurfer.current) {
      wavesurfer.current.setPlaybackRate(newSpeed);
    }
  };

  const increaseVoiceBoost = () => {
    setVoiceBoostLevel(prev => Math.min(prev + 0.2, 2.5));
    processAudio();
  };

  const increaseVolume = () => {
    setVolumeLevel(prev => Math.min(prev + 0.2, 2.0));
    processAudio();
  };

  const increaseClarity = () => {
    setClarityLevel(prev => Math.min(prev + 0.2, 2.0));
    processAudio();
  };

  const increaseNoiseReduction = () => {
    setNoiseReductionLevel(prev => Math.min(prev + 0.1, 0.9));
    processAudio();
  };

  const applySpectralSubtraction = (buffer: Float32Array, noiseProfile: Float32Array): Float32Array => {
    const output = new Float32Array(buffer.length);
    
    for (let i = 0; i < buffer.length; i += 1024) {
      const segment = buffer.slice(i, i + 1024);
      for (let j = 0; j < segment.length; j++) {
        segment[j] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * j / (segment.length - 1));
      }
      
      const noiseSpectrum = noiseProfile.map(x => x * noiseReductionLevel);
      
      for (let j = 0; j < segment.length; j++) {
        output[i + j] = Math.max(0, segment[j] - noiseSpectrum[j % noiseSpectrum.length]);
      }
    }
    
    return output;
  };

  const enhanceFormants = (buffer: Float32Array): Float32Array => {
    const output = new Float32Array(buffer.length);
    const frameSize = 512;
    
    for (let i = 0; i < buffer.length; i += frameSize) {
      const frame = buffer.slice(i, i + frameSize);
      const features = Meyda.extract(['spectralCentroid', 'spectralRolloff'], frame);
      
      const formantEnhancement = Math.max(0.8, Math.min(1.5, features.spectralCentroid / 1000));
      
      for (let j = 0; j < frame.length; j++) {
        if (i + j < output.length) {
          output[i + j] = frame[j] * formantEnhancement * clarityLevel;
        }
      }
    }
    
    return output;
  };

  const processAudio = async () => {
    if (!audioContext || !sourceNode?.buffer) return;
    
    const startTime = performance.now();
    setIsProcessing(true);
    setProcessingStatus('Optimizing audio...');
    
    try {
      const offlineContext = new OfflineAudioContext(
        sourceNode.buffer.numberOfChannels,
        sourceNode.buffer.length,
        sourceNode.buffer.sampleRate
      );
      
      const source = offlineContext.createBufferSource();
      source.buffer = sourceNode.buffer;
      
      const compressor = offlineContext.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      
      const lowFilter = offlineContext.createBiquadFilter();
      lowFilter.type = 'lowshelf';
      lowFilter.frequency.value = 200;
      lowFilter.gain.value = 3;

      const midFilter = offlineContext.createBiquadFilter();
      midFilter.type = 'peaking';
      midFilter.frequency.value = 1500;
      midFilter.Q.value = 1;
      midFilter.gain.value = 6 * clarityLevel;

      const highFilter = offlineContext.createBiquadFilter();
      highFilter.type = 'highshelf';
      highFilter.frequency.value = 3000;
      highFilter.gain.value = 2;
      
      if (pitchCorrection !== 0) {
        const pitchNode = offlineContext.createBiquadFilter();
        pitchNode.type = 'allpass';
        pitchNode.frequency.value = 440 * Math.pow(2, pitchCorrection);
        highFilter.connect(pitchNode);
      }
      
      const gainNode = offlineContext.createGain();
      gainNode.gain.value = volumeLevel;

      source.connect(compressor);
      compressor.connect(lowFilter);
      lowFilter.connect(midFilter);
      midFilter.connect(highFilter);
      highFilter.connect(gainNode);
      gainNode.connect(offlineContext.destination);
      
      source.start(0);
      
      setProcessingStatus('Applying enhancements...');
      
      const processedBuffer = await offlineContext.startRendering();
      const processedData = processedBuffer.getChannelData(0);
      
      const noiseProfile = new Float32Array(1024).fill(0.01);
      const enhancedData = applySpectralSubtraction(processedData, noiseProfile);
      const formantEnhanced = enhanceFormants(enhancedData);
      
      for (let i = 0; i < formantEnhanced.length; i++) {
        formantEnhanced[i] *= voiceBoostLevel;
      }
      
      const finalBuffer = offlineContext.createBuffer(
        1,
        formantEnhanced.length,
        offlineContext.sampleRate
      );
      finalBuffer.copyToChannel(formantEnhanced, 0);
      
      const processedWav = await audioBufferToWav(finalBuffer);
      const newBlob = new Blob([processedWav], { type: 'audio/wav' });
      setProcessedBlob(newBlob);
      wavesurfer.current?.loadBlob(newBlob);
      
      const endTime = performance.now();
      setProcessingTime(endTime - startTime);
      setProcessingStatus('Processing complete!');
    } catch (error) {
      console.error('Error processing audio:', error);
      setProcessingStatus('Error processing audio');
    } finally {
      setIsProcessing(false);
    }
  };

  const audioBufferToWav = (buffer: AudioBuffer): Promise<ArrayBuffer> => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2;
    const result = new ArrayBuffer(44 + length);
    const view = new DataView(result);
    
    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    const sampleRate = buffer.sampleRate;
    const numChannels = buffer.numberOfChannels;
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2 * numChannels, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, length, true);
    
    const offset = 44;
    const channelData = new Float32Array(buffer.length);
    let pos = 0;
    
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      buffer.copyFromChannel(channelData, i, 0);
      for (let j = 0; j < channelData.length; j++) {
        const sample = Math.max(-1, Math.min(1, channelData[j]));
        view.setInt16(offset + pos * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        pos++;
      }
    }
    
    return Promise.resolve(result);
  };

  const downloadAudio = () => {
    if (processedBlob) {
      const url = URL.createObjectURL(processedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'enhanced-audio.wav';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-purple-100">
          <div className="flex items-center gap-3 mb-6">
            <Zap className="w-8 h-8 text-violet-600" />
            <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 text-transparent bg-clip-text">
              Sonic Enhancer Pro
            </h1>
          </div>
          
          <p className="text-gray-600 mb-8">
            Transform your audio with lightning-fast processing and crystal-clear results
          </p>
          
          <div className="space-y-6">
            <div className="border-2 border-dashed border-violet-200 rounded-xl p-8 text-center bg-white/50">
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="hidden"
                id="audio-upload"
              />
              <label
                htmlFor="audio-upload"
                className="flex flex-col items-center cursor-pointer"
              >
                <Upload className="w-12 h-12 text-violet-500 mb-4" />
                <span className="text-violet-600 font-medium">Upload Audio File</span>
                <span className="text-sm text-gray-500 mt-1">or drag and drop here</span>
              </label>
            </div>

            <div 
              ref={waveformRef}
              className="bg-white/50 rounded-xl p-4 shadow-inner"
            />

            {processingTime && (
              <div className="flex items-center justify-center gap-2 text-violet-600">
                <RefreshCw className="w-4 h-4" />
                <span>Processed in {(processingTime / 1000).toFixed(2)} seconds</span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <button
                onClick={toggleAutoLevel}
                className={`flex items-center px-4 py-2 rounded-lg ${
                  autoLevel ? 'bg-violet-600' : 'bg-gray-600'
                } text-white hover:opacity-90 transition`}
              >
                <Sliders className="w-5 h-5 mr-2" />
                <span>Auto-Level {autoLevel ? 'On' : 'Off'}</span>
              </button>

              <button
                onClick={adjustPlaybackSpeed}
                className="flex items-center px-4 py-2 rounded-lg bg-purple-600 text-white hover:opacity-90 transition"
              >
                <RefreshCw className="w-5 h-5 mr-2" />
                <span>Speed: {playbackSpeed}x</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col items-center bg-violet-50 rounded-xl p-4">
                <div className="text-sm font-medium text-violet-900 mb-2">Voice Enhancement</div>
                <div className="flex space-x-2">
                  <button
                    onClick={increaseVoiceBoost}
                    disabled={isProcessing || !sourceNode}
                    className="p-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition flex items-center disabled:opacity-50"
                    title="Boost Voice Presence"
                  >
                    <Mic className="w-5 h-5 mr-2" />
                    <span>Voice Boost ({((voiceBoostLevel - 1) * 100).toFixed(0)}%)</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col items-center bg-purple-50 rounded-xl p-4">
                <div className="text-sm font-medium text-purple-900 mb-2">Volume Control</div>
                <div className="flex space-x-2">
                  <button
                    onClick={increaseVolume}
                    disabled={isProcessing || !sourceNode}
                    className="p-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition flex items-center disabled:opacity-50"
                    title="Increase Volume"
                  >
                    <VolumeUp className="w-5 h-5 mr-2" />
                    <span>Volume ({((volumeLevel - 1) * 100).toFixed(0)}%)</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col items-center bg-fuchsia-50 rounded-xl p-4">
                <div className="text-sm font-medium text-fuchsia-900 mb-2">Clarity Enhancement</div>
                <div className="flex space-x-2">
                  <button
                    onClick={increaseClarity}
                    disabled={isProcessing || !sourceNode}
                    className="p-2 rounded-lg bg-fuchsia-600 text-white hover:bg-fuchsia-700 transition flex items-center disabled:opacity-50"
                    title="Enhance Clarity"
                  >
                    <Waves className="w-5 h-5 mr-2" />
                    <span>Clarity ({((clarityLevel - 1) * 100).toFixed(0)}%)</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col items-center bg-pink-50 rounded-xl p-4">
                <div className="text-sm font-medium text-pink-900 mb-2">Noise Reduction</div>
                <div className="flex space-x-2">
                  <button
                    onClick={increaseNoiseReduction}
                    disabled={isProcessing || !sourceNode}
                    className="p-2 rounded-lg bg-pink-600 text-white hover:bg-pink-700 transition flex items-center disabled:opacity-50"
                    title="Reduce Background Noise"
                  >
                    <Volume1 className="w-5 h-5 mr-2" />
                    <span>Noise Red. ({(noiseReductionLevel * 100).toFixed(0)}%)</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-center space-x-4">
              <button
                onClick={togglePlayPause}
                className="p-3 rounded-full bg-violet-600 text-white hover:bg-violet-700 transition"
              >
                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
              </button>

              <button
                onClick={toggleMute}
                className="p-3 rounded-full bg-violet-600 text-white hover:bg-violet-700 transition"
              >
                {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
              </button>

              <button
                onClick={processAudio}
                disabled={isProcessing || !sourceNode}
                className={`p-3 rounded-full bg-violet-600 text-white hover:bg-violet-700 transition ${
                  (isProcessing || !sourceNode) ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <Wand2 className="w-6 h-6" />
              </button>

              <button
                onClick={downloadAudio}
                disabled={!processedBlob}
                className={`p-3 rounded-full bg-violet-600 text-white hover:bg-violet-700 transition ${
                  !processedBlob ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <Download className="w-6 h-6" />
              </button>
            </div>

            {isProcessing && (
              <div className="mt-4">
                <div className="text-violet-600 font-medium text-center">
                  {processingStatus}
                </div>
                <div className="mt-2 w-full h-2 bg-violet-100 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-600 animate-pulse rounded-full"></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
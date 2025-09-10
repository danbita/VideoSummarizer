const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Import processors
const VideoProcessor = require('./processors/videoProcessor');
const AudioExtractor = require('./processors/audioExtractor');
const FileManager = require('./utils/fileManager');

// Import AI services (Phase 3)
const TranscriptionService = require('./ai/transcriptionService');
const MomentAnalyzer = require('./ai/momentAnalyzer');

// Import Phase 4 processors
const VideoSummarizer = require('./processors/videoSummarizer');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize processors and AI services
const videoProcessor = new VideoProcessor();
const audioExtractor = new AudioExtractor();
const fileManager = new FileManager();
const transcriptionService = new TranscriptionService();
const momentAnalyzer = new MomentAnalyzer();
const videoSummarizer = new VideoSummarizer();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create required directories if they don't exist
const requiredDirs = ['uploads', 'output', 'temp', 'logs', 'segments', 'thumbnails'];
requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = /\.(mp4|avi|mov|mkv|webm)$/i;
    const allowedMimetypes = /^(video\/|application\/octet-stream$)/;
    
    const extname = allowedExtensions.test(file.originalname.toLowerCase());
    const mimetype = allowedMimetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(`Error: Invalid file type. Got mimetype: ${file.mimetype}, extension: ${path.extname(file.originalname)}`);
    }
  }
});

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'FV Video Summarizer API',
    version: '1.0.0',
    status: 'running',
    phase: 'Phase 4 - Complete Video Summarization',
    endpoints: {
      // Phase 2 endpoints
      health: '/health',
      upload: '/upload (POST)',
      test_ffmpeg: '/test-ffmpeg (GET)',
      process_video: '/process (POST)',
      video_info: '/video-info/:filename (GET)',
      extract_audio: '/extract-audio/:filename (POST)',
      file_stats: '/file-stats (GET)',
      cleanup: '/cleanup (POST)',
      logs: '/logs/:jobId (GET)',
      
      // Phase 3 AI endpoints
      transcribe: '/transcribe/:jobId (POST)',
      analyze_moments: '/analyze-moments/:jobId (POST)',
      get_moments: '/moments/:jobId (GET)',
      process_full_ai: '/process-full (POST)',
      
      // Phase 4 Summarization endpoints
      create_summary: '/create-summary/:jobId (POST)',
      quick_summary: '/quick-summary/:jobId (POST)',
      summary_options: '/summary-options (GET)',
      process_and_summarize: '/process-and-summarize (POST)',
      get_summary: '/summary/:jobId (GET)',
      cleanup_job: '/cleanup/:jobId (POST)'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version,
    phase: 'Phase 4 - Complete Video Summarization',
    ai_services: {
      openai: process.env.OPENAI_API_KEY ? 'configured' : 'missing',
      google_ai: process.env.GOOGLE_AI_API_KEY ? 'configured' : 'missing'
    }
  });
});

// === PHASE 2 ENDPOINTS (existing) ===

app.post('/upload', (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      console.log('MULTER ERROR:', err);
      return res.status(500).json({ error: 'Multer error: ' + err.message });
    }
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No video file uploaded' });
      }

      res.json({
        message: 'File uploaded successfully',
        file: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          size: req.file.size,
          path: req.file.path,
          sizeFormatted: fileManager.formatBytes(req.file.size)
        },
        nextSteps: [
          'Visit /video-info/' + req.file.filename + ' to get video metadata',
          'Visit /extract-audio/' + req.file.filename + ' to extract audio',
          'Use /process-full endpoint for complete AI analysis pipeline',
          'Use /process-and-summarize for complete pipeline including video summary'
        ]
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

// Get video metadata
app.get('/video-info/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join('uploads', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    const validation = await videoProcessor.validateVideo(filePath);
    
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Video validation failed',
        details: validation.error
      });
    }

    const metadata = await videoProcessor.getVideoMetadata(filePath);
    const fileInfo = fileManager.getFileInfo(filePath);

    res.json({
      message: 'Video information retrieved successfully',
      validation,
      metadata,
      fileInfo,
      processing: {
        estimatedTime: videoProcessor.estimateProcessingTime(metadata.duration),
        recommendedSettings: audioExtractor.getOptimalSettings(metadata)
      }
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get video information', 
      details: error.message 
    });
  }
});

// Extract audio from video
app.post('/extract-audio/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join('uploads', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    const jobId = Date.now().toString();
    fileManager.logActivity(jobId, 'audio_extraction_started', { filename });

    console.log(`Starting audio extraction for: ${filename}`);
    
    const result = await audioExtractor.extractAudio(filePath, 'temp');
    const audioValidation = await audioExtractor.validateAudioForTranscription(result.audioPath);
    
    fileManager.logActivity(jobId, 'audio_extraction_completed', { 
      audioFile: result.filename,
      validation: audioValidation 
    });

    res.json({
      message: 'Audio extraction completed successfully',
      jobId,
      audio: result,
      validation: audioValidation,
      nextSteps: [
        'Use /transcribe/' + jobId + ' for speech-to-text conversion',
        'Audio file will be cleaned up automatically after 24 hours'
      ]
    });

  } catch (error) {
    console.error('Audio extraction failed:', error);
    res.status(500).json({ 
      error: 'Audio extraction failed', 
      details: error.message 
    });
  }
});

// === PHASE 3 AI ENDPOINTS ===

// Transcribe audio using OpenAI Whisper
app.post('/transcribe/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    
    // Find audio file for this job
    const logs = fileManager.getJobLogs(jobId);
    const audioLog = logs.find(log => log.activity === 'audio_extraction_completed');
    
    if (!audioLog) {
      return res.status(404).json({ error: 'Audio extraction job not found' });
    }

    const audioPath = audioLog.details.audioFile ? 
      path.join('temp', audioLog.details.audioFile) : null;

    if (!audioPath || !fs.existsSync(audioPath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    fileManager.logActivity(jobId, 'transcription_started', { audioPath });
    console.log(`Starting transcription for job: ${jobId}`);

    // Transcribe using OpenAI Whisper
    const transcription = await transcriptionService.transcribeAudio(audioPath, {
      language: req.body.language || 'en',
      prompt: req.body.prompt
    });

    // Process transcription for analysis
    const processedTranscription = transcriptionService.processTranscriptionForAnalysis(transcription);
    
    // Validate transcription quality
    const validation = transcriptionService.validateTranscription(transcription);

    fileManager.logActivity(jobId, 'transcription_completed', { 
      transcription: processedTranscription,
      validation 
    });

    res.json({
      message: 'Transcription completed successfully',
      jobId,
      transcription,
      processed: processedTranscription,
      validation,
      nextSteps: [
        'Use /analyze-moments/' + jobId + ' for AI moment detection',
        'Get results with /moments/' + jobId
      ]
    });

  } catch (error) {
    console.error('Transcription failed:', error);
    fileManager.logActivity(req.params.jobId, 'transcription_failed', { error: error.message });
    res.status(500).json({ 
      error: 'Transcription failed', 
      details: error.message 
    });
  }
});

// Analyze key moments using Google Gemini
app.post('/analyze-moments/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    
    // Get transcription and video info from job logs
    const logs = fileManager.getJobLogs(jobId);
    const transcriptionLog = logs.find(log => log.activity === 'transcription_completed');
    const audioLog = logs.find(log => log.activity === 'audio_extraction_completed');
    
    if (!transcriptionLog || !audioLog) {
      return res.status(404).json({ error: 'Transcription or audio extraction not found for this job' });
    }

    // Find original video file
    const processingLog = logs.find(log => log.activity === 'processing_started');
    if (!processingLog) {
      return res.status(404).json({ error: 'Original video processing not found' });
    }

    const videoPath = path.join('temp', processingLog.details.processingFile);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Original video file not found' });
    }

    fileManager.logActivity(jobId, 'moment_analysis_started', { videoPath });
    console.log(`Starting moment analysis for job: ${jobId}`);

    // Analyze using Google Gemini
    const analysis = await momentAnalyzer.analyzeKeyMoments(
      videoPath, 
      transcriptionLog.details.transcription,
      req.body.options || {}
    );

    // Validate analysis results
    const validation = momentAnalyzer.validateAnalysis(analysis?.analysis || {}, transcriptionLog.details.transcription);

    fileManager.logActivity(jobId, 'moment_analysis_completed', { 
      analysis,
      validation 
    });

    res.json({
      message: 'Moment analysis completed successfully',
      jobId,
      analysis,
      validation,
      nextSteps: [
        'Get detailed moments with /moments/' + jobId,
        'Create video summary with /create-summary/' + jobId,
        'Or use /quick-summary/' + jobId + ' for fast results'
      ]
    });

  } catch (error) {
    console.error('Moment analysis failed:', error);
    fileManager.logActivity(req.params.jobId, 'moment_analysis_failed', { error: error.message });
    res.status(500).json({ 
      error: 'Moment analysis failed', 
      details: error.message 
    });
  }
});

// Get key moments for a job
app.get('/moments/:jobId', (req, res) => {
  try {
    const jobId = req.params.jobId;
    const logs = fileManager.getJobLogs(jobId);
    
    const momentLog = logs.find(log => log.activity === 'moment_analysis_completed');
    const transcriptionLog = logs.find(log => log.activity === 'transcription_completed');
    
    if (!momentLog) {
      return res.status(404).json({ error: 'Moment analysis not found for this job' });
    }

    const analysis = momentLog.details.analysis?.analysis || {};
    const moments = analysis.keyMoments || [];
    const validation = momentLog.details.validation;
    const transcription = transcriptionLog ? transcriptionLog.details.transcription : null;

    res.json({
      message: 'Key moments retrieved successfully',
      jobId,
      moments: {
        moments: moments,
        summary: analysis.summary || 'No summary available',
        totalOriginalDuration: analysis.totalOriginalDuration || 0,
        recommendedSummaryDuration: analysis.recommendedSummaryDuration || 0,
        compressionRatio: analysis.compressionRatio || 0,
        momentCount: analysis.momentCount || 0,
        contentType: analysis.contentType || 'unknown',
        recommendedApproach: analysis.recommendedApproach || 'No recommendations available'
      },
      validation,
      transcription,
      summary: {
        totalMoments: analysis.momentCount || 0,
        originalDuration: analysis.totalOriginalDuration || 0,
        summaryDuration: analysis.recommendedSummaryDuration || 0,
        compressionRatio: (analysis.compressionRatio || 0) + '%'
      }
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get moments', 
      details: error.message 
    });
  }
});

// Full AI processing pipeline
app.post('/process-full', upload.single('video'), async (req, res) => {
  let jobId = null;
  let tempFiles = [];

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    jobId = Date.now().toString();
    console.log(`Starting full AI processing pipeline - Job ID: ${jobId}`);

    // Move file to processing directory
    const processResult = await fileManager.moveToProcessing(req.file.path, req.file.originalname);
    tempFiles.push(processResult.newPath);

    fileManager.logActivity(jobId, 'processing_started', {
      originalFile: req.file.originalname,
      processingFile: processResult.filename
    });

    // Step 1: Validate video
    console.log('Step 1: Validating video...');
    const validation = await videoProcessor.validateVideo(processResult.newPath);
    
    if (!validation.valid) {
      throw new Error(`Video validation failed: ${validation.error}`);
    }

    // Step 2: Get metadata
    console.log('Step 2: Extracting metadata...');
    const metadata = await videoProcessor.getVideoMetadata(processResult.newPath);
    
    fileManager.logActivity(jobId, 'metadata_extracted', { metadata });

    // Step 3: Extract audio
    console.log('Step 3: Extracting audio...');
    const audioResult = await audioExtractor.extractAudio(processResult.newPath, 'temp');
    tempFiles.push(audioResult.audioPath);

    fileManager.logActivity(jobId, 'audio_extraction_completed', { 
      audioFile: audioResult.filename,
      validation: await audioExtractor.validateAudioForTranscription(audioResult.audioPath)
    });

    // Step 4: Transcribe audio
    console.log('Step 4: Transcribing audio...');
    const transcription = await transcriptionService.transcribeAudio(audioResult.audioPath);
    const processedTranscription = transcriptionService.processTranscriptionForAnalysis(transcription);
    
    fileManager.logActivity(jobId, 'transcription_completed', { 
      transcription: processedTranscription 
    });

    // Step 5: Analyze moments
    console.log('Step 5: Analyzing key moments...');
    const analysis = await momentAnalyzer.analyzeKeyMoments(processResult.newPath, processedTranscription);
    
    // Console log the analysis structure for debugging
    console.log('Analysis structure:', JSON.stringify(analysis, null, 2));
    
    fileManager.logActivity(jobId, 'moment_analysis_completed', { 
      analysis,
      validation: momentAnalyzer.validateAnalysis(analysis?.analysis || {}, processedTranscription)
    });

    fileManager.logActivity(jobId, 'full_processing_completed', {
      processingTime: Date.now() - parseInt(jobId)
    });

    // Safe property access with fallbacks
    const analysisData = analysis?.analysis || {};
    const keyMoments = analysisData.keyMoments || [];
    
    res.json({
      message: 'Full AI processing completed successfully',
      jobId,
      processing: {
        validation,
        metadata,
        audio: audioResult,
        transcription,
        moments: keyMoments,
        tempFiles: tempFiles.map(f => path.basename(f))
      },
      summary: {
        originalDuration: metadata.duration,
        summaryDuration: analysisData.recommendedSummaryDuration || 0,
        compressionRatio: (analysisData.compressionRatio || 0) + '%',
        momentCount: analysisData.momentCount || 0,
        transcriptionWords: transcription.wordCount || 0
      },
      nextSteps: [
        'Use /moments/' + jobId + ' to get detailed key moments',
        'Create video summary with /create-summary/' + jobId,
        'Or use /quick-summary/' + jobId + ' for fast results'
      ]
    });

  } catch (error) {
    console.error('Full AI processing failed:', error);
    
    // Clean up temp files on error
    tempFiles.forEach(filePath => {
      fileManager.cleanupFile(filePath);
    });

    if (jobId) {
      fileManager.logActivity(jobId, 'full_processing_failed', { error: error.message });
    }

    res.status(500).json({ 
      error: 'Full AI processing failed', 
      details: error.message,
      jobId 
    });
  }
});

// === PHASE 4 VIDEO SUMMARIZATION ENDPOINTS ===

// Create video summary from detected moments
app.post('/create-summary/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    
    // Get analysis results from job logs
    const logs = fileManager.getJobLogs(jobId);
    const momentLog = logs.find(log => log.activity === 'moment_analysis_completed');
    const processingLog = logs.find(log => log.activity === 'processing_started');
    
    if (!momentLog || !processingLog) {
      return res.status(404).json({ 
        error: 'Moment analysis or original video not found for this job' 
      });
    }

    // Get video path and moments
    const videoPath = path.join('temp', processingLog.details.processingFile);
    const moments = momentLog.details.analysis?.analysis?.keyMoments || [];
    
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Original video file not found' });
    }

    if (moments.length === 0) {
      return res.status(400).json({ error: 'No moments available for summarization' });
    }

    fileManager.logActivity(jobId, 'video_summarization_started', { 
      momentsCount: moments.length,
      options: req.body 
    });

    console.log(`Starting video summarization for job: ${jobId}`);

    // Create video summary with user options
    const summaryResult = await videoSummarizer.createVideoSummary(
      videoPath,
      moments,
      req.body || {},
      jobId
    );

    fileManager.logActivity(jobId, 'video_summarization_completed', { 
      result: summaryResult 
    });

    res.json({
      message: 'Video summary created successfully',
      jobId,
      summary: summaryResult,
      nextSteps: [
        'Download your summary video from /output/' + summaryResult.output.finalVideo.filename,
        'Review individual segments if needed',
        'Use /cleanup/' + jobId + ' to remove temporary files'
      ]
    });

  } catch (error) {
    console.error('Video summarization failed:', error);
    fileManager.logActivity(req.params.jobId, 'video_summarization_failed', { 
      error: error.message 
    });
    res.status(500).json({ 
      error: 'Video summarization failed', 
      details: error.message 
    });
  }
});

// Quick summary with default settings
app.post('/quick-summary/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    
    // Get required data
    const logs = fileManager.getJobLogs(jobId);
    const momentLog = logs.find(log => log.activity === 'moment_analysis_completed');
    const processingLog = logs.find(log => log.activity === 'processing_started');
    
    if (!momentLog || !processingLog) {
      return res.status(404).json({ 
        error: 'Required data not found for this job' 
      });
    }

    const videoPath = path.join('temp', processingLog.details.processingFile);
    const moments = momentLog.details.analysis?.analysis?.keyMoments || [];
    
    console.log(`Creating quick summary for job: ${jobId}`);

    // Create quick summary (top 5 moments, fast processing)
    const summaryResult = await videoSummarizer.createQuickSummary(
      videoPath,
      moments,
      jobId
    );

    fileManager.logActivity(jobId, 'quick_summary_completed', { result: summaryResult });

    res.json({
      message: 'Quick summary created successfully',
      jobId,
      summary: summaryResult,
      processingNote: 'Quick summary uses top 5 moments with fast processing'
    });

  } catch (error) {
    console.error('Quick summary failed:', error);
    res.status(500).json({ 
      error: 'Quick summary failed', 
      details: error.message 
    });
  }
});

// Get summarization capabilities and options
app.get('/summary-options', (req, res) => {
  try {
    const capabilities = videoSummarizer.getCapabilities();
    
    res.json({
      message: 'Video summarization options and capabilities',
      capabilities,
      examples: {
        basicSummary: {
          maxMoments: 5,
          minImportance: 6,
          composition: {
            enableTransitions: false,
            qualityPreset: 'medium'
          }
        },
        highQualitySummary: {
          minImportance: 7,
          composition: {
            enableTransitions: true,
            transitionDuration: 0.5,
            qualityPreset: 'slow',
            crf: 20
          },
          createThumbnails: true
        },
        quickPreview: {
          maxMoments: 3,
          composition: {
            qualityPreset: 'ultrafast',
            crf: 28
          }
        }
      }
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get summary options', 
      details: error.message 
    });
  }
});

// Full pipeline: AI analysis + video summarization
app.post('/process-and-summarize', upload.single('video'), async (req, res) => {
  let jobId = null;
  let tempFiles = [];

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    jobId = Date.now().toString();
    console.log(`Starting full pipeline (Process + Summarize) - Job ID: ${jobId}`);

    // Move file to processing directory
    const processResult = await fileManager.moveToProcessing(req.file.path, req.file.originalname);
    tempFiles.push(processResult.newPath);

    fileManager.logActivity(jobId, 'full_pipeline_started', {
      originalFile: req.file.originalname,
      processingFile: processResult.filename
    });

    // === PHASE 1-3: AI ANALYSIS (same as process-full) ===
    
    // Step 1: Validate video
    console.log('Step 1: Validating video...');
    const validation = await videoProcessor.validateVideo(processResult.newPath);
    if (!validation.valid) {
      throw new Error(`Video validation failed: ${validation.error}`);
    }

    // Step 2: Get metadata
    console.log('Step 2: Extracting metadata...');
    const metadata = await videoProcessor.getVideoMetadata(processResult.newPath);
    fileManager.logActivity(jobId, 'metadata_extracted', { metadata });

    // Step 3: Extract audio
    console.log('Step 3: Extracting audio...');
    const audioResult = await audioExtractor.extractAudio(processResult.newPath, 'temp');
    tempFiles.push(audioResult.audioPath);

    // Step 4: Transcribe audio
    console.log('Step 4: Transcribing audio...');
    const transcription = await transcriptionService.transcribeAudio(audioResult.audioPath);
    const processedTranscription = transcriptionService.processTranscriptionForAnalysis(transcription);

    // Step 5: Analyze moments
    console.log('Step 5: Analyzing key moments...');
    const analysis = await momentAnalyzer.analyzeKeyMoments(processResult.newPath, processedTranscription);
    const moments = analysis?.analysis?.keyMoments || [];

    if (moments.length === 0) {
      throw new Error('No moments detected for summarization');
    }

    // === PHASE 4: VIDEO SUMMARIZATION ===
    
    console.log('Step 6: Creating video summary...');
    const summaryOptions = req.body.summaryOptions || {
      maxMoments: 6,
      minImportance: 5,
      composition: {
        enableTransitions: false,
        qualityPreset: 'medium'
      }
    };

    const summaryResult = await videoSummarizer.createVideoSummary(
      processResult.newPath,
      moments,
      summaryOptions,
      jobId
    );

    fileManager.logActivity(jobId, 'full_pipeline_completed', {
      processingTime: Date.now() - parseInt(jobId),
      summary: summaryResult
    });

    // Safe property access for final response
    const analysisData = analysis?.analysis || {};

    res.json({
      message: 'Full pipeline completed successfully - Video processed and summarized',
      jobId,
      
      // Phase 1-3 results
      processing: {
        validation,
        metadata,
        transcription,
        analysis: {
          momentsDetected: moments.length,
          totalDuration: analysisData.totalOriginalDuration || 0,
          categories: [...new Set(moments.map(m => m.category))]
        }
      },

      // Phase 4 results
      summary: summaryResult,

      // Overall statistics
      results: {
        originalDuration: metadata.duration,
        finalDuration: summaryResult.output.finalVideo.metadata.duration,
        compressionRatio: summaryResult.statistics.compression.compressionRatio + '%',
        momentsUsed: summaryResult.statistics.compression.usedMoments,
        outputVideo: summaryResult.output.finalVideo.filename
      },

      nextSteps: [
        'Download your summary video: ' + summaryResult.output.finalVideo.filename,
        'Review the processing details above',
        'Use /cleanup/' + jobId + ' when finished to remove temporary files'
      ]
    });

  } catch (error) {
    console.error('Full pipeline failed:', error);
    
    // Clean up temp files on error
    tempFiles.forEach(filePath => {
      fileManager.cleanupFile(filePath);
    });

    if (jobId) {
      fileManager.logActivity(jobId, 'full_pipeline_failed', { error: error.message });
    }

    res.status(500).json({ 
      error: 'Full pipeline failed', 
      details: error.message,
      jobId 
    });
  }
});

// Get summary result for a job
app.get('/summary/:jobId', (req, res) => {
  try {
    const jobId = req.params.jobId;
    const logs = fileManager.getJobLogs(jobId);
    
    const summaryLog = logs.find(log => 
      log.activity === 'video_summarization_completed' || 
      log.activity === 'quick_summary_completed' ||
      log.activity === 'full_pipeline_completed'
    );
    
    if (!summaryLog) {
      return res.status(404).json({ error: 'Summary not found for this job' });
    }

    const summaryData = summaryLog.details.result || summaryLog.details.summary;
    
    res.json({
      message: 'Summary retrieved successfully',
      jobId,
      summary: summaryData,
      created: summaryLog.timestamp,
      downloadUrl: summaryData.output ? 
        '/output/' + summaryData.output.finalVideo.filename : null
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get summary', 
      details: error.message 
    });
  }
});

// Clean up all files for a job
app.post('/cleanup/:jobId', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    
    // Clean up Phase 4 files
    const cleanupResult = await videoSummarizer.cleanupJob(jobId);
    
    // Clean up Phase 1-3 temp files
    const maxAge = 0; // Clean immediately
    const tempCleanup = await fileManager.cleanupTempFiles(maxAge, jobId);
    
    fileManager.logActivity(jobId, 'cleanup_completed', { 
      phase4: cleanupResult,
      temp: tempCleanup 
    });

    res.json({
      message: 'Cleanup completed successfully',
      jobId,
      results: {
        phase4Cleanup: cleanupResult,
        tempCleanup: tempCleanup
      }
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Cleanup failed', 
      details: error.message 
    });
  }
});

// === EXISTING PHASE 2 ENDPOINTS ===

app.get('/file-stats', (req, res) => {
  try {
    const stats = fileManager.getDirectoryStats();
    
    res.json({
      message: 'File system statistics',
      directories: stats,
      cleanup: {
        lastCleanup: 'Manual cleanup available at /cleanup endpoint',
        recommendation: 'Run cleanup daily to free disk space'
      }
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get file statistics', 
      details: error.message 
    });
  }
});

app.post('/cleanup', async (req, res) => {
  try {
    const maxAge = req.body.maxAgeHours || 24;
    const result = await fileManager.cleanupTempFiles(maxAge);
    
    res.json({
      message: 'Cleanup completed',
      result
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Cleanup failed', 
      details: error.message 
    });
  }
});

app.get('/logs/:jobId', (req, res) => {
  try {
    const jobId = req.params.jobId;
    const logs = fileManager.getJobLogs(jobId);
    
    res.json({
      message: 'Job logs retrieved',
      jobId,
      logs,
      totalEntries: logs.length
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get job logs', 
      details: error.message 
    });
  }
});

app.get('/test-ffmpeg', async (req, res) => {
  const ffmpeg = require('fluent-ffmpeg');
  
  try {
    ffmpeg.getAvailableFormats((err, formats) => {
      if (err) {
        return res.status(500).json({ 
          error: 'FFmpeg not working', 
          details: err.message 
        });
      }
      
      res.json({
        message: 'FFmpeg is working!',
        availableFormats: Object.keys(formats).length,
        sampleFormats: Object.keys(formats).slice(0, 10),
        phase4Status: 'Video summarization ready'
      });
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'FFmpeg test failed', 
      details: error.message 
    });
  }
});

// === STATIC FILE SERVING ===

// Serve output videos, segments, and thumbnails statically
app.use('/output', express.static('output'));
app.use('/segments', express.static('segments'));
app.use('/thumbnails', express.static('thumbnails'));

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
  }
  res.status(500).json({ error: error.message });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 FV Video Summarizer API running on port ${PORT}`);
  console.log(`📁 Upload directory: ${path.resolve('uploads')}`);
  console.log(`📁 Output directory: ${path.resolve('output')}`);
  console.log(`📁 Segments directory: ${path.resolve('segments')}`);
  console.log(`📁 Thumbnails directory: ${path.resolve('thumbnails')}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🤖 Phase 4: Complete Video Summarization System`);
  console.log(`🔑 OpenAI API: ${process.env.OPENAI_API_KEY ? 'Configured' : 'Missing'}`);
  console.log(`🔑 Google AI API: ${process.env.GOOGLE_AI_API_KEY ? 'Configured' : 'Missing'}`);
});
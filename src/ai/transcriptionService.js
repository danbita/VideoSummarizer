const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

class TranscriptionService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.maxFileSize = 25 * 1024 * 1024; // 25MB limit for Whisper
  }

  /**
   * Transcribe audio file using OpenAI Whisper
   */
  async transcribeAudio(audioPath, options = {}) {
    try {
      console.log(`Starting transcription for: ${audioPath}`);
      
      // Validate file exists
      if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
      }

      // Check file size
      const stats = fs.statSync(audioPath);
      if (stats.size > this.maxFileSize) {
        throw new Error(`Audio file too large: ${(stats.size / (1024 * 1024)).toFixed(2)}MB (max: 25MB)`);
      }

      console.log(`File size: ${(stats.size / (1024 * 1024)).toFixed(2)}MB`);

      // Create readable stream for OpenAI
      const audioStream = fs.createReadStream(audioPath);
      
      // Transcription parameters
      const transcriptionParams = {
        file: audioStream,
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        language: options.language || 'en', // Default to English
        prompt: options.prompt || "This is a screen recording with user interactions, UI descriptions, and technical content."
      };

      console.log('Sending request to OpenAI Whisper...');
      const transcription = await this.openai.audio.transcriptions.create(transcriptionParams);
      
      console.log('Transcription completed successfully');
      
      // Process and format the response
      const result = {
        success: true,
        text: transcription.text,
        language: transcription.language,
        duration: transcription.duration,
        segments: transcription.segments || [],
        words: transcription.words || [],
        wordCount: transcription.text.split(' ').length,
        confidence: this.calculateAverageConfidence(transcription.segments),
        timestamp: new Date().toISOString()
      };

      return result;

    } catch (error) {
      console.error('Transcription failed:', error);
      
      if (error.code === 'file_too_large') {
        throw new Error('Audio file exceeds 25MB limit for transcription');
      }
      
      if (error.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      
      if (error.status === 401) {
        throw new Error('Invalid OpenAI API key');
      }

      throw new Error(`Transcription failed: ${error.message}`);
    }
  }

  /**
   * Process transcription for key moment detection
   */
  processTranscriptionForAnalysis(transcription) {
    const segments = transcription.segments || [];
    
    return {
      fullText: transcription.text,
      timestampedSegments: segments.map(segment => ({
        start: segment.start,
        end: segment.end,
        text: segment.text.trim(),
        confidence: segment.avg_logprob || 0,
        wordCount: segment.text.split(' ').length
      })),
      totalDuration: transcription.duration,
      language: transcription.language,
      wordLevelTimestamps: transcription.words || []
    };
  }

  /**
   * Calculate average confidence from segments
   */
  calculateAverageConfidence(segments) {
    if (!segments || segments.length === 0) return 0;
    
    const confidenceScores = segments
      .map(s => s.avg_logprob || 0)
      .filter(score => !isNaN(score));
    
    if (confidenceScores.length === 0) return 0;
    
    const avgLogProb = confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length;
    
    // Convert log probability to confidence percentage (rough approximation)
    return Math.max(0, Math.min(100, (avgLogProb + 1) * 100));
  }

  /**
   * Split long audio files for processing
   */
  async splitAudioIfNeeded(audioPath, maxDuration = 300) {
    // For files longer than maxDuration seconds, we'd need to split them
    // This is a placeholder for future implementation
    const stats = fs.statSync(audioPath);
    
    if (stats.size > this.maxFileSize) {
      throw new Error('Audio file too large for processing. Please implement audio splitting.');
    }
    
    return [audioPath]; // Return array of file paths
  }

  /**
   * Validate transcription quality
   */
  validateTranscription(transcription) {
    const issues = [];
    const recommendations = [];

    // Check if transcription is too short
    if (transcription.text.length < 10) {
      issues.push('Transcription is very short - audio may be silent or unclear');
    }

    // Check confidence level
    if (transcription.confidence < 30) {
      issues.push('Low transcription confidence - audio quality may be poor');
      recommendations.push('Consider improving audio quality or using a different audio source');
    }

    // Check for repetitive content (possible audio issues)
    const words = transcription.text.split(' ');
    const uniqueWords = new Set(words);
    const repetitionRatio = uniqueWords.size / words.length;
    
    if (repetitionRatio < 0.3) {
      recommendations.push('High word repetition detected - check for audio loop or echo issues');
    }

    // Check language detection
    if (transcription.language !== 'en' && transcription.language !== 'english') {
      recommendations.push(`Detected language: ${transcription.language}. Ensure this matches your content.`);
    }

    return {
      valid: issues.length === 0,
      issues,
      recommendations,
      confidence: transcription.confidence,
      qualityScore: this.calculateQualityScore(transcription)
    };
  }

  /**
   * Calculate overall transcription quality score
   */
  calculateQualityScore(transcription) {
    let score = 0;

    // Base score from confidence
    score += Math.min(50, transcription.confidence || 0);

    // Bonus for reasonable length
    const textLength = transcription.text.length;
    if (textLength > 50 && textLength < 10000) {
      score += 20;
    }

    // Bonus for word-level timestamps
    if (transcription.words && transcription.words.length > 0) {
      score += 15;
    }

    // Bonus for multiple segments
    if (transcription.segments && transcription.segments.length > 1) {
      score += 15;
    }

    return Math.min(100, score);
  }

  /**
   * Extract key phrases from transcription
   */
  extractKeyPhrases(transcription) {
    const text = transcription.text.toLowerCase();
    
    // Common UI/technical terms that might indicate key moments
    const keyPhrases = [
      'click', 'tap', 'press', 'button', 'menu', 'dialog', 'popup',
      'error', 'warning', 'alert', 'notification', 'message',
      'load', 'loading', 'wait', 'processing', 'complete',
      'login', 'logout', 'sign in', 'sign out', 'submit',
      'save', 'delete', 'create', 'edit', 'update',
      'search', 'filter', 'sort', 'select', 'choose'
    ];

    const foundPhrases = keyPhrases.filter(phrase => text.includes(phrase));
    
    return {
      phrases: foundPhrases,
      count: foundPhrases.length,
      density: foundPhrases.length / transcription.text.split(' ').length
    };
  }
}

module.exports = TranscriptionService;
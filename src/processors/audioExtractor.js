const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

class AudioExtractor {
  constructor() {
    this.outputFormat = 'mp3';
    this.sampleRate = 16000; // Optimized for speech recognition
    this.channels = 1; // Mono for better transcription
    this.bitrate = '128k';
  }

  /**
   * Extract audio from video file
   */
  async extractAudio(inputVideoPath, outputDir = 'temp') {
    try {
      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Generate output filename
      const inputFilename = path.basename(inputVideoPath, path.extname(inputVideoPath));
      const outputFilename = `${inputFilename}-audio-${Date.now()}.${this.outputFormat}`;
      const outputPath = path.join(outputDir, outputFilename);

      console.log(`Extracting audio from: ${inputVideoPath}`);
      console.log(`Output path: ${outputPath}`);

      const result = await this.performExtraction(inputVideoPath, outputPath);
      
      return {
        success: true,
        audioPath: outputPath,
        filename: outputFilename,
        size: result.size,
        duration: result.duration,
        format: this.outputFormat,
        sampleRate: this.sampleRate,
        channels: this.channels,
        message: 'Audio extraction completed successfully'
      };

    } catch (error) {
      console.error('Audio extraction failed:', error);
      throw new Error(`Audio extraction failed: ${error.message}`);
    }
  }

  /**
   * Perform the actual audio extraction using FFmpeg
   */
  async performExtraction(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      let duration = 0;
      
      ffmpeg(inputPath)
        .toFormat(this.outputFormat)
        .audioChannels(this.channels)
        .audioFrequency(this.sampleRate)
        .audioBitrate(this.bitrate)
        .audioCodec('libmp3lame')
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.timemark) {
            duration = this.parseTimemark(progress.timemark);
          }
          console.log(`Audio extraction progress: ${Math.round(progress.percent || 0)}%`);
        })
        .on('end', () => {
          console.log('Audio extraction completed');
          
          // Get file size
          const stats = fs.statSync(outputPath);
          
          resolve({
            size: stats.size,
            duration: duration,
            sizeMB: (stats.size / (1024 * 1024)).toFixed(2)
          });
        })
        .on('error', (err) => {
          console.error('FFmpeg error during audio extraction:', err);
          // Clean up partial file if it exists
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
          reject(err);
        })
        .run();
    });
  }

  /**
   * Extract audio with custom settings
   */
  async extractAudioCustom(inputPath, outputPath, options = {}) {
    const settings = {
      format: options.format || this.outputFormat,
      sampleRate: options.sampleRate || this.sampleRate,
      channels: options.channels || this.channels,
      bitrate: options.bitrate || this.bitrate,
      startTime: options.startTime || null,
      duration: options.duration || null
    };

    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath)
        .toFormat(settings.format)
        .audioChannels(settings.channels)
        .audioFrequency(settings.sampleRate)
        .audioBitrate(settings.bitrate);

      // Add start time if specified
      if (settings.startTime) {
        command = command.seekInput(settings.startTime);
      }

      // Add duration limit if specified
      if (settings.duration) {
        command = command.duration(settings.duration);
      }

      command
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('Custom audio extraction command:', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`Custom extraction progress: ${Math.round(progress.percent || 0)}%`);
        })
        .on('end', () => {
          const stats = fs.statSync(outputPath);
          resolve({
            success: true,
            outputPath,
            size: stats.size,
            settings
          });
        })
        .on('error', (err) => {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
          reject(new Error(`Custom audio extraction failed: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * Validate audio file quality for speech recognition
   */
  async validateAudioForTranscription(audioPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) {
          return reject(new Error(`Audio validation failed: ${err.message}`));
        }

        const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
        
        if (!audioStream) {
          return reject(new Error('No audio stream found in file'));
        }

        const validation = {
          valid: true,
          issues: [],
          recommendations: []
        };

        // Check sample rate (optimal: 16kHz for speech)
        const sampleRate = parseInt(audioStream.sample_rate);
        if (sampleRate < 8000) {
          validation.issues.push(`Low sample rate: ${sampleRate}Hz (minimum recommended: 8kHz)`);
        }
        if (sampleRate < 16000) {
          validation.recommendations.push('Consider using 16kHz sample rate for better transcription accuracy');
        }

        // Check duration
        const duration = parseFloat(metadata.format.duration);
        if (duration < 1) {
          validation.issues.push('Audio too short for reliable transcription');
        }
        if (duration > 1800) { // 30 minutes
          validation.recommendations.push('Long audio files may need to be chunked for processing');
        }

        // Check channels
        if (audioStream.channels > 1) {
          validation.recommendations.push('Mono audio often provides better transcription results');
        }

        validation.valid = validation.issues.length === 0;
        
        resolve({
          ...validation,
          metadata: {
            duration: duration,
            sampleRate: sampleRate,
            channels: audioStream.channels,
            codec: audioStream.codec_name,
            bitrate: parseInt(audioStream.bit_rate) || 0
          }
        });
      });
    });
  }

  /**
   * Parse FFmpeg timemark (e.g., "00:01:23.45" -> 83.45)
   */
  parseTimemark(timemark) {
    const parts = timemark.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      const seconds = parseFloat(parts[2]) || 0;
      return hours * 3600 + minutes * 60 + seconds;
    }
    return 0;
  }

  /**
   * Clean up temporary audio files
   */
  async cleanup(audioPath) {
    try {
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
        console.log(`Cleaned up audio file: ${audioPath}`);
        return true;
      }
    } catch (error) {
      console.error(`Failed to clean up audio file ${audioPath}:`, error.message);
      return false;
    }
  }

  /**
   * Get optimal audio extraction settings based on video metadata
   */
  getOptimalSettings(videoMetadata) {
    const settings = {
      format: 'mp3',
      channels: 1, // Always mono for transcription
      bitrate: '128k'
    };

    // Adjust sample rate based on video audio quality
    if (videoMetadata.audio && videoMetadata.audio.sampleRate) {
      const originalSampleRate = videoMetadata.audio.sampleRate;
      if (originalSampleRate >= 44100) {
        settings.sampleRate = 16000; // Downsample high-quality audio
      } else if (originalSampleRate >= 16000) {
        settings.sampleRate = 16000; // Keep optimal rate
      } else {
        settings.sampleRate = originalSampleRate; // Don't upsample low-quality audio
      }
    } else {
      settings.sampleRate = 16000; // Default
    }

    // Adjust bitrate for longer videos to save space
    if (videoMetadata.duration > 600) { // 10+ minutes
      settings.bitrate = '96k';
    }

    return settings;
  }
}

module.exports = AudioExtractor;
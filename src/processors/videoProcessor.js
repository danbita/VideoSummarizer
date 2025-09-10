const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

class VideoProcessor {
  constructor() {
    this.supportedFormats = ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv'];
  }

  /**
   * Extract comprehensive metadata from video file
   */
  async getVideoMetadata(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          console.error('FFprobe error:', err);
          return reject(new Error(`Failed to read video metadata: ${err.message}`));
        }

        try {
          const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
          const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');

          const result = {
            // File info
            filename: path.basename(filePath),
            filesize: metadata.format.size,
            duration: parseFloat(metadata.format.duration) || 0,
            bitrate: parseInt(metadata.format.bit_rate) || 0,
            format: metadata.format.format_name,

            // Video info
            video: videoStream ? {
              codec: videoStream.codec_name,
              width: videoStream.width,
              height: videoStream.height,
              fps: this.parseFPS(videoStream.r_frame_rate),
              bitrate: parseInt(videoStream.bit_rate) || 0,
              pixelFormat: videoStream.pix_fmt
            } : null,

            // Audio info
            audio: audioStream ? {
              codec: audioStream.codec_name,
              sampleRate: parseInt(audioStream.sample_rate) || 0,
              channels: audioStream.channels,
              bitrate: parseInt(audioStream.bit_rate) || 0,
              channelLayout: audioStream.channel_layout
            } : null,

            // Calculated fields
            aspectRatio: videoStream ? (videoStream.width / videoStream.height).toFixed(2) : null,
            durationFormatted: this.formatDuration(parseFloat(metadata.format.duration) || 0),
            filesizeMB: ((metadata.format.size || 0) / (1024 * 1024)).toFixed(2)
          };

          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse metadata: ${error.message}`));
        }
      });
    });
  }

  /**
   * Validate if video file is processable
   */
  async validateVideo(filePath) {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error('Video file does not exist');
      }

      // Check file size (limit to 500MB)
      const stats = fs.statSync(filePath);
      const maxSize = 500 * 1024 * 1024; // 500MB
      if (stats.size > maxSize) {
        throw new Error(`File too large: ${(stats.size / (1024 * 1024)).toFixed(2)}MB (max: 500MB)`);
      }

      // Get metadata to validate format
      const metadata = await this.getVideoMetadata(filePath);
      
      // Check if it has video stream
      if (!metadata.video) {
        throw new Error('File does not contain video stream');
      }

      // Check duration (must be at least 1 second, max 30 minutes)
      if (metadata.duration < 1) {
        throw new Error('Video too short (minimum: 1 second)');
      }
      if (metadata.duration > 1800) { // 30 minutes
        throw new Error('Video too long (maximum: 30 minutes)');
      }

      return {
        valid: true,
        metadata,
        message: 'Video validation successful'
      };

    } catch (error) {
      return {
        valid: false,
        error: error.message,
        message: 'Video validation failed'
      };
    }
  }

  /**
   * Get video thumbnail at specific timestamp
   */
  async generateThumbnail(inputPath, outputPath, timestamp = '00:00:01') {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: [timestamp],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: '320x240'
        })
        .on('end', () => {
          console.log(`Thumbnail generated: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error('Thumbnail generation failed:', err);
          reject(new Error(`Thumbnail generation failed: ${err.message}`));
        });
    });
  }

  /**
   * Check if video format is supported
   */
  isFormatSupported(filename) {
    const ext = path.extname(filename).toLowerCase().slice(1);
    return this.supportedFormats.includes(ext);
  }

  /**
   * Parse frame rate from FFmpeg format (e.g., "30/1" -> 30)
   */
  parseFPS(frameRate) {
    if (!frameRate) return 0;
    
    if (frameRate.includes('/')) {
      const [numerator, denominator] = frameRate.split('/').map(Number);
      return Math.round((numerator / denominator) * 100) / 100;
    }
    
    return parseFloat(frameRate) || 0;
  }

  /**
   * Format duration in seconds to HH:MM:SS
   */
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Estimate processing time based on video duration
   */
  estimateProcessingTime(duration) {
    // Rough estimate: processing takes 2-3x video duration
    const baseTime = duration * 2.5;
    const audiExtractionTime = 10; // ~10 seconds for audio extraction
    const aiProcessingTime = duration * 0.5; // AI processing time
    
    return Math.ceil(baseTime + audiExtractionTime + aiProcessingTime);
  }
}

module.exports = VideoProcessor;
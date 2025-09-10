const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

class VideoSegmenter {
  constructor() {
    this.outputDir = 'segments';
    this.tempDir = 'temp';
    
    // Ensure directories exist
    [this.outputDir, this.tempDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Extract individual moment clips from the original video
   * @param {string} videoPath - Path to original video
   * @param {Array} moments - Array of moment objects with startTime/endTime
   * @param {string} jobId - Unique job identifier
   * @returns {Promise<Object>} - Results with segment paths and metadata
   */
  async extractMomentClips(videoPath, moments, jobId) {
    try {
      console.log(`Starting video segmentation for job: ${jobId}`);
      console.log(`Processing ${moments.length} moments from: ${videoPath}`);

      if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      if (!moments || moments.length === 0) {
        throw new Error('No moments provided for segmentation');
      }

      const segmentResults = [];
      const jobOutputDir = path.join(this.outputDir, jobId);
      
      // Create job-specific output directory
      if (!fs.existsSync(jobOutputDir)) {
        fs.mkdirSync(jobOutputDir, { recursive: true });
      }

      // Extract each moment as a separate video clip
      for (let i = 0; i < moments.length; i++) {
        const moment = moments[i];
        const segmentResult = await this.extractSingleMoment(
          videoPath, 
          moment, 
          i, 
          jobOutputDir
        );
        segmentResults.push(segmentResult);
      }

      console.log(`Segmentation completed: ${segmentResults.length} clips created`);

      return {
        success: true,
        jobId,
        totalSegments: segmentResults.length,
        segments: segmentResults,
        outputDirectory: jobOutputDir,
        totalDuration: segmentResults.reduce((sum, seg) => sum + seg.duration, 0)
      };

    } catch (error) {
      console.error('Video segmentation failed:', error);
      throw new Error(`Segmentation failed: ${error.message}`);
    }
  }

  /**
   * Extract a single moment clip
   * @param {string} videoPath - Original video path
   * @param {Object} moment - Moment object with timing info
   * @param {number} index - Moment index for naming
   * @param {string} outputDir - Output directory for this job
   * @returns {Promise<Object>} - Segment metadata
   */
  async extractSingleMoment(videoPath, moment, index, outputDir) {
    return new Promise((resolve, reject) => {
      const startTime = moment.startTime;
      const endTime = moment.endTime;
      const duration = endTime - startTime;
      
      // Generate safe filename
      const safeTitle = this.sanitizeFilename(moment.title || `moment_${index + 1}`);
      const outputFilename = `${String(index + 1).padStart(2, '0')}_${safeTitle}.mp4`;
      const outputPath = path.join(outputDir, outputFilename);

      console.log(`Extracting moment ${index + 1}: "${moment.title}" (${startTime}s - ${endTime}s)`);

      ffmpeg(videoPath)
        .seekInput(startTime)
        .duration(duration)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-preset fast',
          '-crf 23',
          '-movflags +faststart',
          '-avoid_negative_ts make_zero'
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`FFmpeg command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          const percent = Math.round(progress.percent || 0);
          if (percent % 20 === 0) { // Log every 20%
            console.log(`Moment ${index + 1} progress: ${percent}%`);
          }
        })
        .on('end', () => {
          console.log(`Moment ${index + 1} extracted successfully`);
          
          // Get file info
          const stats = fs.statSync(outputPath);
          
          resolve({
            index: index + 1,
            title: moment.title,
            description: moment.description,
            category: moment.category,
            importance: moment.importance,
            originalStartTime: startTime,
            originalEndTime: endTime,
            duration: duration,
            filename: outputFilename,
            path: outputPath,
            fileSize: stats.size,
            fileSizeMB: (stats.size / (1024 * 1024)).toFixed(2)
          });
        })
        .on('error', (error) => {
          console.error(`Failed to extract moment ${index + 1}:`, error);
          reject(new Error(`Segment extraction failed: ${error.message}`));
        })
        .run();
    });
  }

  /**
   * Create a preview thumbnail for each segment
   * @param {string} segmentPath - Path to segment video
   * @param {string} outputPath - Path for thumbnail output
   * @returns {Promise<string>} - Thumbnail path
   */
  async createSegmentThumbnail(segmentPath, outputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg(segmentPath)
        .screenshots({
          timestamps: ['50%'],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: '320x180'
        })
        .on('end', () => {
          console.log(`Thumbnail created: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (error) => {
          console.error('Thumbnail creation failed:', error);
          reject(error);
        });
    });
  }

  /**
   * Validate segment quality and duration
   * @param {string} segmentPath - Path to segment
   * @param {number} expectedDuration - Expected duration in seconds
   * @returns {Promise<Object>} - Validation results
   */
  async validateSegment(segmentPath, expectedDuration) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(segmentPath, (err, metadata) => {
        if (err) {
          return reject(err);
        }

        const actualDuration = metadata.format.duration;
        const durationDiff = Math.abs(actualDuration - expectedDuration);
        const toleranceSeconds = 0.5; // Allow 0.5s difference

        const validation = {
          valid: durationDiff <= toleranceSeconds,
          expectedDuration,
          actualDuration,
          durationDifference: durationDiff,
          fileSize: metadata.format.size,
          bitRate: metadata.format.bit_rate,
          hasVideo: metadata.streams.some(s => s.codec_type === 'video'),
          hasAudio: metadata.streams.some(s => s.codec_type === 'audio')
        };

        resolve(validation);
      });
    });
  }

  /**
   * Generate segment metadata summary
   * @param {Array} segments - Array of segment objects
   * @returns {Object} - Summary metadata
   */
  generateSegmentSummary(segments) {
    const totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);
    const totalFileSize = segments.reduce((sum, seg) => sum + seg.fileSize, 0);
    
    const categoryCounts = segments.reduce((counts, seg) => {
      counts[seg.category] = (counts[seg.category] || 0) + 1;
      return counts;
    }, {});

    const importanceStats = {
      min: Math.min(...segments.map(s => s.importance)),
      max: Math.max(...segments.map(s => s.importance)),
      avg: segments.reduce((sum, s) => sum + s.importance, 0) / segments.length
    };

    return {
      totalSegments: segments.length,
      totalDuration: Math.round(totalDuration * 100) / 100,
      totalFileSizeMB: (totalFileSize / (1024 * 1024)).toFixed(2),
      categoryCounts,
      importanceStats,
      averageDuration: Math.round((totalDuration / segments.length) * 100) / 100,
      segments: segments.map(seg => ({
        index: seg.index,
        title: seg.title,
        duration: seg.duration,
        importance: seg.importance,
        category: seg.category
      }))
    };
  }

  /**
   * Sanitize filename for cross-platform compatibility
   * @param {string} filename - Original filename
   * @returns {string} - Sanitized filename
   */
  sanitizeFilename(filename) {
    return filename
      .replace(/[^a-zA-Z0-9\s-_]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 50) // Limit length
      .toLowerCase();
  }

  /**
   * Clean up segment files for a job
   * @param {string} jobId - Job ID to clean up
   * @returns {Promise<Object>} - Cleanup results
   */
  async cleanupSegments(jobId) {
    try {
      const jobOutputDir = path.join(this.outputDir, jobId);
      
      if (!fs.existsSync(jobOutputDir)) {
        return { success: true, message: 'No segments to clean up' };
      }

      const files = fs.readdirSync(jobOutputDir);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(jobOutputDir, file);
        fs.unlinkSync(filePath);
        deletedCount++;
      }

      // Remove the directory
      fs.rmdirSync(jobOutputDir);

      return {
        success: true,
        deletedFiles: deletedCount,
        message: `Cleaned up ${deletedCount} segment files for job ${jobId}`
      };

    } catch (error) {
      console.error('Segment cleanup failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = VideoSegmenter;
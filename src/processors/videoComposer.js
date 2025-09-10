const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

class VideoComposer {
  constructor() {
    this.outputDir = 'output';
    this.tempDir = 'temp';
    
    // Ensure directories exist
    [this.outputDir, this.tempDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Compose segments into final summary video
   * @param {Array} segments - Array of segment objects with paths
   * @param {Object} options - Composition options
   * @param {string} jobId - Job identifier
   * @returns {Promise<Object>} - Final video metadata
   */
  async composeSegments(segments, options = {}, jobId) {
    try {
      console.log(`Starting video composition for job: ${jobId}`);
      console.log(`Composing ${segments.length} segments`);

      // Validate segments
      this.validateSegments(segments);

      // Sort segments by importance if requested
      const sortedSegments = this.sortSegments(segments, options.sortBy || 'order');

      // Generate composition plan
      const compositionPlan = this.generateCompositionPlan(sortedSegments, options);
      console.log('Composition plan:', JSON.stringify(compositionPlan, null, 2));

      // Create the composed video
      const result = await this.createComposedVideo(
        sortedSegments, 
        compositionPlan, 
        jobId
      );

      return result;

    } catch (error) {
      console.error('Video composition failed:', error);
      throw new Error(`Composition failed: ${error.message}`);
    }
  }

  /**
   * Create the final composed video using FFmpeg
   * @param {Array} segments - Segments to compose
   * @param {Object} plan - Composition plan
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} - Final video info
   */
  async createComposedVideo(segments, plan, jobId) {
    return new Promise((resolve, reject) => {
      const outputFilename = `summary_${jobId}.mp4`;
      const outputPath = path.join(this.outputDir, outputFilename);
      const concatFile = path.join(this.tempDir, `concat_${jobId}.txt`);

      try {
        // Create FFmpeg concat file
        this.createConcatFile(segments, concatFile, plan);

        console.log(`Creating composed video: ${outputPath}`);

        let ffmpegCommand = ffmpeg()
          .input(concatFile)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-preset', 'medium',
            '-crf', '23',
            '-movflags', '+faststart',
            '-r', '30' // Ensure consistent frame rate
          ]);

        // Add transitions if enabled
        if (plan.transitions.enabled) {
          ffmpegCommand = this.addTransitions(ffmpegCommand, plan);
        }

        // Add title/intro if requested
        if (plan.intro.enabled) {
          ffmpegCommand = this.addIntroTitle(ffmpegCommand, plan);
        }

        ffmpegCommand
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log(`FFmpeg composition command: ${commandLine}`);
          })
          .on('progress', (progress) => {
            const percent = Math.round(progress.percent || 0);
            if (percent % 10 === 0 && percent > 0) {
              console.log(`Composition progress: ${percent}%`);
            }
          })
          .on('end', async () => {
            console.log('Video composition completed successfully');
            
            // Clean up concat file
            fs.unlinkSync(concatFile);
            
            // Get final video metadata
            const metadata = await this.getFinalVideoMetadata(outputPath);
            
            resolve({
              success: true,
              jobId,
              outputPath,
              filename: outputFilename,
              metadata,
              compositionPlan: plan,
              segments: segments.map(seg => ({
                title: seg.title,
                duration: seg.duration,
                importance: seg.importance
              }))
            });
          })
          .on('error', (error) => {
            console.error('FFmpeg composition error:', error);
            
            // Clean up on error
            if (fs.existsSync(concatFile)) {
              fs.unlinkSync(concatFile);
            }
            
            reject(new Error(`Video composition failed: ${error.message}`));
          })
          .run();

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Create FFmpeg concat file
   * @param {Array} segments - Video segments
   * @param {string} concatPath - Path for concat file
   * @param {Object} plan - Composition plan
   */
  createConcatFile(segments, concatPath, plan) {
    let concatContent = '';

    segments.forEach((segment, index) => {
      if (!fs.existsSync(segment.path)) {
        throw new Error(`Segment file not found: ${segment.path}`);
      }

      // Add segment
      concatContent += `file '${path.resolve(segment.path)}'\n`;

      // Add transition duration if not the last segment
      if (index < segments.length - 1 && plan.transitions.enabled) {
        concatContent += `duration ${plan.transitions.duration}\n`;
      }
    });

    fs.writeFileSync(concatPath, concatContent);
    console.log(`Created concat file: ${concatPath}`);
  }

  /**
   * Generate composition plan based on options
   * @param {Array} segments - Video segments
   * @param {Object} options - User options
   * @returns {Object} - Composition plan
   */
  generateCompositionPlan(segments, options) {
    const plan = {
      totalSegments: segments.length,
      estimatedDuration: segments.reduce((sum, seg) => sum + seg.duration, 0),
      
      transitions: {
        enabled: options.enableTransitions !== false,
        type: options.transitionType || 'fade',
        duration: options.transitionDuration || 0.5
      },
      
      intro: {
        enabled: options.enableIntro || false,
        duration: options.introDuration || 2,
        text: options.introText || 'Key Moments Summary'
      },
      
      speed: {
        enabled: options.enableSpeedAdjustment || false,
        factor: options.speedFactor || 1.0
      },
      
      quality: {
        preset: options.qualityPreset || 'medium',
        crf: options.crf || 23
      },
      
      audio: {
        enabled: options.includeAudio !== false,
        normalize: options.normalizeAudio || true
      }
    };

    // Adjust for speed changes
    if (plan.speed.enabled && plan.speed.factor !== 1.0) {
      plan.estimatedDuration = plan.estimatedDuration / plan.speed.factor;
    }

    // Add transition time
    if (plan.transitions.enabled) {
      plan.estimatedDuration += (segments.length - 1) * plan.transitions.duration;
    }

    // Add intro time
    if (plan.intro.enabled) {
      plan.estimatedDuration += plan.intro.duration;
    }

    return plan;
  }

  /**
   * Sort segments based on specified criteria
   * @param {Array} segments - Original segments
   * @param {string} sortBy - Sort criteria: 'order', 'importance', 'duration'
   * @returns {Array} - Sorted segments
   */
  sortSegments(segments, sortBy) {
    const sortedSegments = [...segments];

    switch (sortBy) {
      case 'importance':
        return sortedSegments.sort((a, b) => b.importance - a.importance);
      
      case 'duration':
        return sortedSegments.sort((a, b) => b.duration - a.duration);
      
      case 'chronological':
        return sortedSegments.sort((a, b) => a.originalStartTime - b.originalStartTime);
      
      case 'order':
      default:
        return sortedSegments.sort((a, b) => a.index - b.index);
    }
  }

  /**
   * Add transitions between segments (placeholder for complex transitions)
   * @param {Object} ffmpegCommand - FFmpeg command object
   * @param {Object} plan - Composition plan
   * @returns {Object} - Modified FFmpeg command
   */
  addTransitions(ffmpegCommand, plan) {
    // For now, we'll use simple concatenation
    // Advanced transitions would require more complex FFmpeg filter graphs
    console.log(`Transitions enabled: ${plan.transitions.type} (${plan.transitions.duration}s)`);
    return ffmpegCommand;
  }

  /**
   * Add intro title to video (placeholder)
   * @param {Object} ffmpegCommand - FFmpeg command
   * @param {Object} plan - Composition plan
   * @returns {Object} - Modified FFmpeg command
   */
  addIntroTitle(ffmpegCommand, plan) {
    // Intro titles would require drawtext filter
    console.log(`Intro enabled: "${plan.intro.text}" (${plan.intro.duration}s)`);
    return ffmpegCommand;
  }

  /**
   * Get metadata for final composed video
   * @param {string} videoPath - Path to final video
   * @returns {Promise<Object>} - Video metadata
   */
  async getFinalVideoMetadata(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          return reject(err);
        }

        const format = metadata.format;
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        const stats = fs.statSync(videoPath);

        resolve({
          filename: path.basename(videoPath),
          duration: parseFloat(format.duration),
          durationFormatted: this.formatDuration(format.duration),
          fileSize: stats.size,
          fileSizeMB: (stats.size / (1024 * 1024)).toFixed(2),
          bitRate: parseInt(format.bit_rate),
          format: format.format_name,
          video: videoStream ? {
            codec: videoStream.codec_name,
            width: videoStream.width,
            height: videoStream.height,
            fps: eval(videoStream.r_frame_rate) // Convert fraction to decimal
          } : null,
          audio: audioStream ? {
            codec: audioStream.codec_name,
            sampleRate: audioStream.sample_rate,
            channels: audioStream.channels
          } : null
        });
      });
    });
  }

  /**
   * Validate segments before composition
   * @param {Array} segments - Segments to validate
   * @throws {Error} - If validation fails
   */
  validateSegments(segments) {
    if (!segments || segments.length === 0) {
      throw new Error('No segments provided for composition');
    }

    // Check if all segment files exist
    for (const segment of segments) {
      if (!segment.path || !fs.existsSync(segment.path)) {
        throw new Error(`Segment file not found: ${segment.path}`);
      }
    }

    console.log(`Validation passed for ${segments.length} segments`);
  }

  /**
   * Format duration in seconds to MM:SS format
   * @param {number} seconds - Duration in seconds
   * @returns {string} - Formatted duration
   */
  formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Create a preview video with lower quality for quick review
   * @param {Array} segments - Video segments
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} - Preview video info
   */
  async createPreview(segments, jobId) {
    const previewOptions = {
      enableTransitions: false,
      enableIntro: false,
      qualityPreset: 'ultrafast',
      crf: 28
    };

    const previewPlan = this.generateCompositionPlan(segments, previewOptions);
    
    // Create preview with "_preview" suffix
    const originalOutputPath = path.join(this.outputDir, `summary_${jobId}.mp4`);
    const previewPath = originalOutputPath.replace('.mp4', '_preview.mp4');

    console.log('Creating preview video...');
    
    return this.createComposedVideo(segments, previewPlan, `${jobId}_preview`);
  }

  /**
   * Get composition statistics
   * @param {Array} segments - Original segments
   * @param {Object} finalMetadata - Final video metadata
   * @returns {Object} - Statistics
   */
  getCompositionStats(segments, finalMetadata) {
    const originalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);
    const compressionRatio = ((originalDuration - finalMetadata.duration) / originalDuration * 100);

    return {
      originalSegments: segments.length,
      originalDuration: Math.round(originalDuration * 100) / 100,
      finalDuration: finalMetadata.duration,
      compressionRatio: Math.round(compressionRatio * 100) / 100,
      fileSizeMB: finalMetadata.fileSizeMB,
      averageSegmentDuration: Math.round((originalDuration / segments.length) * 100) / 100,
      qualityMetrics: {
        bitRate: finalMetadata.bitRate,
        resolution: finalMetadata.video ? `${finalMetadata.video.width}x${finalMetadata.video.height}` : 'N/A',
        fps: finalMetadata.video ? finalMetadata.video.fps : 'N/A'
      }
    };
  }
}

module.exports = VideoComposer;
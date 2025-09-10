const VideoSegmenter = require('./videoSegmenter');
const VideoComposer = require('./videoComposer');
const fs = require('fs');
const path = require('path');

class VideoSummarizer {
  constructor() {
    this.segmenter = new VideoSegmenter();
    this.composer = new VideoComposer();
  }

  /**
   * Complete video summarization process
   * @param {string} videoPath - Path to original video
   * @param {Array} moments - Detected moments from Phase 3
   * @param {Object} options - Summarization options
   * @param {string} jobId - Job identifier
   * @returns {Promise<Object>} - Complete summarization results
   */
  async createVideoSummary(videoPath, moments, options = {}, jobId) {
    try {
      console.log(`Starting Phase 4: Video Summarization for job ${jobId}`);
      console.log(`Input: ${videoPath} with ${moments.length} moments`);

      // Validate inputs
      this.validateInputs(videoPath, moments);

      // Apply moment filtering if requested
      const filteredMoments = this.filterMoments(moments, options);
      console.log(`Using ${filteredMoments.length} moments after filtering`);

      // Step 1: Extract moment clips
      console.log('Step 1: Extracting moment clips...');
      const segmentResult = await this.segmenter.extractMomentClips(
        videoPath, 
        filteredMoments, 
        jobId
      );

      if (!segmentResult.success) {
        throw new Error('Segment extraction failed');
      }

      // Step 2: Create thumbnails for segments (optional)
      if (options.createThumbnails) {
        console.log('Step 2: Creating segment thumbnails...');
        await this.createSegmentThumbnails(segmentResult.segments, jobId);
      }

      // Step 3: Compose final summary video
      console.log('Step 3: Composing final summary video...');
      const compositionResult = await this.composer.composeSegments(
        segmentResult.segments,
        options.composition || {},
        jobId
      );

      if (!compositionResult.success) {
        throw new Error('Video composition failed');
      }

      // Step 4: Generate final summary and statistics
      const summary = this.generateFinalSummary(
        segmentResult,
        compositionResult,
        filteredMoments,
        options
      );

      // Optional: Create preview version
      if (options.createPreview) {
        console.log('Creating preview version...');
        const previewResult = await this.composer.createPreview(
          segmentResult.segments,
          jobId
        );
        summary.preview = previewResult;
      }

      console.log('Phase 4: Video Summarization completed successfully');
      return summary;

    } catch (error) {
      console.error('Video summarization failed:', error);
      throw new Error(`Summarization failed: ${error.message}`);
    }
  }

  /**
   * Filter moments based on options
   * @param {Array} moments - Original moments
   * @param {Object} options - Filtering options
   * @returns {Array} - Filtered moments
   */
  filterMoments(moments, options) {
    let filtered = [...moments];

    // Filter by minimum importance
    if (options.minImportance) {
      filtered = filtered.filter(m => m.importance >= options.minImportance);
    }

    // Filter by categories
    if (options.includeCategories && options.includeCategories.length > 0) {
      filtered = filtered.filter(m => options.includeCategories.includes(m.category));
    }

    // Filter by maximum duration
    if (options.maxMomentDuration) {
      filtered = filtered.filter(m => (m.endTime - m.startTime) <= options.maxMomentDuration);
    }

    // Limit total number of moments
    if (options.maxMoments && filtered.length > options.maxMoments) {
      // Sort by importance and take top N
      filtered = filtered
        .sort((a, b) => b.importance - a.importance)
        .slice(0, options.maxMoments);
    }

    // Sort moments for final order
    const sortBy = options.sortMomentsBy || 'chronological';
    switch (sortBy) {
      case 'importance':
        filtered.sort((a, b) => b.importance - a.importance);
        break;
      case 'duration':
        filtered.sort((a, b) => (b.endTime - b.startTime) - (a.endTime - a.startTime));
        break;
      case 'chronological':
      default:
        filtered.sort((a, b) => a.startTime - b.startTime);
        break;
    }

    return filtered;
  }

  /**
   * Create thumbnails for all segments
   * @param {Array} segments - Segment objects
   * @param {string} jobId - Job ID
   * @returns {Promise<Array>} - Updated segments with thumbnail paths
   */
  async createSegmentThumbnails(segments, jobId) {
    const thumbDir = path.join('thumbnails', jobId);
    if (!fs.existsSync(thumbDir)) {
      fs.mkdirSync(thumbDir, { recursive: true });
    }

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const thumbPath = path.join(thumbDir, `${segment.filename.replace('.mp4', '.jpg')}`);
      
      try {
        await this.segmenter.createSegmentThumbnail(segment.path, thumbPath);
        segment.thumbnail = thumbPath;
      } catch (error) {
        console.warn(`Failed to create thumbnail for segment ${i + 1}:`, error.message);
        segment.thumbnail = null;
      }
    }

    return segments;
  }

  /**
   * Generate comprehensive final summary
   * @param {Object} segmentResult - Segmentation results
   * @param {Object} compositionResult - Composition results
   * @param {Array} moments - Original moments
   * @param {Object} options - User options
   * @returns {Object} - Complete summary
   */
  generateFinalSummary(segmentResult, compositionResult, moments, options) {
    const stats = this.composer.getCompositionStats(
      segmentResult.segments,
      compositionResult.metadata
    );

    const segmentSummary = this.segmenter.generateSegmentSummary(segmentResult.segments);

    return {
      success: true,
      jobId: compositionResult.jobId,
      
      // Output files
      output: {
        finalVideo: {
          path: compositionResult.outputPath,
          filename: compositionResult.filename,
          url: `/output/${compositionResult.filename}`,
          metadata: compositionResult.metadata
        },
        segments: segmentResult.segments.map(seg => ({
          title: seg.title,
          filename: seg.filename,
          duration: seg.duration,
          importance: seg.importance,
          category: seg.category,
          thumbnail: seg.thumbnail || null
        })),
        segmentDirectory: segmentResult.outputDirectory
      },

      // Statistics and analysis
      statistics: {
        processing: stats,
        segments: segmentSummary,
        compression: {
          originalMoments: moments.length,
          usedMoments: segmentResult.totalSegments,
          originalTotalDuration: moments.reduce((sum, m) => sum + (m.endTime - m.startTime), 0),
          finalDuration: compositionResult.metadata.duration,
          compressionRatio: stats.compressionRatio,
          timeReduction: Math.round((stats.originalDuration - stats.finalDuration) * 100) / 100
        }
      },

      // Processing details
      processing: {
        options: options,
        compositionPlan: compositionResult.compositionPlan,
        momentsFiltered: moments.length - segmentResult.totalSegments,
        processingTime: new Date().toISOString(),
        quality: {
          preset: compositionResult.compositionPlan.quality.preset,
          crf: compositionResult.compositionPlan.quality.crf,
          finalBitrate: compositionResult.metadata.bitRate
        }
      },

      // Usage instructions
      nextSteps: [
        `Download the summary video: ${compositionResult.filename}`,
        'Review individual segments if needed',
        'Share or integrate the condensed video',
        'Clean up temporary files when done'
      ]
    };
  }

  /**
   * Validate inputs before processing
   * @param {string} videoPath - Video file path
   * @param {Array} moments - Moments array
   * @throws {Error} - If validation fails
   */
  validateInputs(videoPath, moments) {
    if (!videoPath || !fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }

    if (!moments || !Array.isArray(moments) || moments.length === 0) {
      throw new Error('No moments provided for summarization');
    }

    // Validate moment structure
    for (const moment of moments) {
      if (!moment.startTime || !moment.endTime || moment.startTime >= moment.endTime) {
        throw new Error(`Invalid moment timing: ${JSON.stringify(moment)}`);
      }
    }

    console.log('Input validation passed');
  }

  /**
   * Get summarization capabilities and options
   * @returns {Object} - Available options and their descriptions
   */
  getCapabilities() {
    return {
      filtering: {
        minImportance: 'Filter moments by minimum importance score (1-10)',
        includeCategories: 'Array of categories to include (e.g., ["decision", "data_review"])',
        maxMomentDuration: 'Maximum duration per moment in seconds',
        maxMoments: 'Maximum number of moments to include',
        sortMomentsBy: 'Sort order: "chronological", "importance", or "duration"'
      },
      composition: {
        enableTransitions: 'Add transitions between segments (true/false)',
        transitionType: 'Type of transition: "fade", "slide", etc.',
        transitionDuration: 'Transition duration in seconds',
        enableIntro: 'Add intro title card (true/false)',
        introText: 'Custom intro text',
        qualityPreset: 'FFmpeg preset: "ultrafast", "fast", "medium", "slow"',
        crf: 'Quality level: 18 (high) to 28 (lower)'
      },
      output: {
        createThumbnails: 'Generate thumbnail images for segments',
        createPreview: 'Create low-quality preview version',
        includeAudio: 'Include audio in final video (true/false)'
      }
    };
  }

  /**
   * Create a quick summary with default settings
   * @param {string} videoPath - Original video path
   * @param {Array} moments - Detected moments
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} - Quick summary result
   */
  async createQuickSummary(videoPath, moments, jobId) {
    const quickOptions = {
      // Filter to top 5 most important moments
      maxMoments: 5,
      minImportance: 6,
      sortMomentsBy: 'importance',
      
      // Simple composition
      composition: {
        enableTransitions: false,
        enableIntro: false,
        qualityPreset: 'fast',
        crf: 25
      },
      
      // No extras
      createThumbnails: false,
      createPreview: false
    };

    return this.createVideoSummary(videoPath, moments, quickOptions, jobId);
  }

  /**
   * Clean up all files for a job
   * @param {string} jobId - Job ID to clean up
   * @returns {Promise<Object>} - Cleanup results
   */
  async cleanupJob(jobId) {
    try {
      const results = {
        segments: await this.segmenter.cleanupSegments(jobId),
        thumbnails: this.cleanupThumbnails(jobId),
        output: this.cleanupOutput(jobId)
      };

      return {
        success: true,
        jobId,
        results,
        message: `Cleanup completed for job ${jobId}`
      };

    } catch (error) {
      return {
        success: false,
        jobId,
        error: error.message
      };
    }
  }

  /**
   * Clean up thumbnails for a job
   * @param {string} jobId - Job ID
   * @returns {Object} - Cleanup result
   */
  cleanupThumbnails(jobId) {
    try {
      const thumbDir = path.join('thumbnails', jobId);
      if (fs.existsSync(thumbDir)) {
        const files = fs.readdirSync(thumbDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(thumbDir, file));
        });
        fs.rmdirSync(thumbDir);
        return { success: true, deletedFiles: files.length };
      }
      return { success: true, deletedFiles: 0 };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up output files for a job
   * @param {string} jobId - Job ID
   * @returns {Object} - Cleanup result
   */
  cleanupOutput(jobId) {
    try {
      const outputFiles = [
        `summary_${jobId}.mp4`,
        `summary_${jobId}_preview.mp4`
      ];

      let deletedCount = 0;
      outputFiles.forEach(filename => {
        const filePath = path.join('output', filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      });

      return { success: true, deletedFiles: deletedCount };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = VideoSummarizer;
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class FileManager {
  constructor() {
    this.baseDir = process.cwd();
    this.uploadDir = path.join(this.baseDir, 'uploads');
    this.outputDir = path.join(this.baseDir, 'output');
    this.tempDir = path.join(this.baseDir, 'temp');
    this.logsDir = path.join(this.baseDir, 'logs');
    
    this.initializeDirectories();
  }

  /**
   * Initialize required directories
   */
  initializeDirectories() {
    const dirs = [this.uploadDir, this.outputDir, this.tempDir, this.logsDir];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
      }
    });
  }

  /**
   * Generate unique filename with timestamp
   */
  generateUniqueFilename(originalName, prefix = '', suffix = '') {
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    const timestamp = Date.now();
    const uuid = uuidv4().split('-')[0]; // Short UUID
    
    return `${prefix}${baseName}-${timestamp}-${uuid}${suffix}${ext}`;
  }

  /**
   * Move uploaded file to processing directory
   */
  async moveToProcessing(sourcePath, originalName) {
    try {
      const newFilename = this.generateUniqueFilename(originalName, 'proc-');
      const targetPath = path.join(this.tempDir, newFilename);
      
      // Copy file to temp directory
      fs.copyFileSync(sourcePath, targetPath);
      
      // Remove original upload file
      fs.unlinkSync(sourcePath);
      
      return {
        success: true,
        newPath: targetPath,
        filename: newFilename,
        directory: 'temp'
      };
    } catch (error) {
      throw new Error(`Failed to move file to processing: ${error.message}`);
    }
  }

  /**
   * Save processed file to output directory
   */
  async saveToOutput(sourcePath, originalName, type = 'processed') {
    try {
      const newFilename = this.generateUniqueFilename(originalName, `${type}-`);
      const targetPath = path.join(this.outputDir, newFilename);
      
      fs.copyFileSync(sourcePath, targetPath);
      
      return {
        success: true,
        outputPath: targetPath,
        filename: newFilename,
        publicUrl: `/download/${newFilename}`,
        directory: 'output'
      };
    } catch (error) {
      throw new Error(`Failed to save to output: ${error.message}`);
    }
  }

  /**
   * Clean up temporary files older than specified hours
   */
  async cleanupTempFiles(maxAgeHours = 24) {
    try {
      const tempFiles = fs.readdirSync(this.tempDir);
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
      let cleanedCount = 0;
      let totalSize = 0;

      for (const filename of tempFiles) {
        const filePath = path.join(this.tempDir, filename);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          totalSize += stats.size;
          fs.unlinkSync(filePath);
          cleanedCount++;
          console.log(`Cleaned up temp file: ${filename}`);
        }
      }

      return {
        success: true,
        filesRemoved: cleanedCount,
        spaceFreed: this.formatBytes(totalSize),
        message: `Cleaned up ${cleanedCount} temporary files`
      };
    } catch (error) {
      console.error('Cleanup failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up specific file
   */
  async cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        fs.unlinkSync(filePath);
        
        return {
          success: true,
          filename: path.basename(filePath),
          size: this.formatBytes(stats.size),
          message: 'File cleaned up successfully'
        };
      } else {
        return {
          success: true,
          message: 'File does not exist (already cleaned up)'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get file information
   */
  getFileInfo(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error('File does not exist');
      }

      const stats = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      
      return {
        path: filePath,
        filename: path.basename(filePath),
        extension: ext,
        size: stats.size,
        sizeFormatted: this.formatBytes(stats.size),
        created: stats.birthtime,
        modified: stats.mtime,
        isVideo: this.isVideoFile(ext),
        isAudio: this.isAudioFile(ext),
        exists: true
      };
    } catch (error) {
      return {
        path: filePath,
        exists: false,
        error: error.message
      };
    }
  }

  /**
   * Get directory usage statistics
   */
  getDirectoryStats() {
    const stats = {};
    
    const directories = {
      uploads: this.uploadDir,
      output: this.outputDir,
      temp: this.tempDir,
      logs: this.logsDir
    };

    Object.entries(directories).forEach(([name, dir]) => {
      try {
        const files = fs.readdirSync(dir);
        let totalSize = 0;
        let fileCount = 0;

        files.forEach(filename => {
          const filePath = path.join(dir, filename);
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            totalSize += stat.size;
            fileCount++;
          }
        });

        stats[name] = {
          path: dir,
          fileCount,
          totalSize,
          totalSizeFormatted: this.formatBytes(totalSize),
          files: files.slice(0, 10) // Show first 10 files
        };
      } catch (error) {
        stats[name] = {
          path: dir,
          error: error.message
        };
      }
    });

    return stats;
  }

  /**
   * Validate file path security
   */
  validatePath(filePath) {
    const resolvedPath = path.resolve(filePath);
    const allowedDirs = [this.uploadDir, this.outputDir, this.tempDir];
    
    return allowedDirs.some(dir => resolvedPath.startsWith(path.resolve(dir)));
  }

  /**
   * Create job directory for processing
   */
  createJobDirectory(jobId) {
    const jobDir = path.join(this.tempDir, `job-${jobId}`);
    
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }
    
    return jobDir;
  }

  /**
   * Check available disk space
   */
  getAvailableSpace() {
    try {
      const stats = fs.statSync(this.baseDir);
      // Note: This is a simplified check. In production, you might want to use a library
      // like 'check-disk-space' for more accurate disk space information
      
      return {
        available: true,
        message: 'Disk space check not implemented (add check-disk-space package for production)'
      };
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Format bytes to human readable format
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  /**
   * Check if file is a video
   */
  isVideoFile(extension) {
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v'];
    return videoExtensions.includes(extension.toLowerCase());
  }

  /**
   * Check if file is an audio file
   */
  isAudioFile(extension) {
    const audioExtensions = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'];
    return audioExtensions.includes(extension.toLowerCase());
  }

  /**
   * Log processing activity
   */
  logActivity(jobId, activity, details = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      jobId,
      activity,
      details
    };

    const logFile = path.join(this.logsDir, `processing-${new Date().toISOString().split('T')[0]}.log`);
    const logLine = JSON.stringify(logEntry) + '\n';

    fs.appendFileSync(logFile, logLine);
  }

  /**
   * Get processing logs for a specific job
   */
  getJobLogs(jobId) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(this.logsDir, `processing-${today}.log`);
      
      if (!fs.existsSync(logFile)) {
        return [];
      }

      const logs = fs.readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
        .filter(log => log.jobId === jobId);

      return logs;
    } catch (error) {
      console.error('Failed to get job logs:', error);
      return [];
    }
  }
}

module.exports = FileManager;
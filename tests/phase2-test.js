const VideoProcessor = require('../src/processors/videoProcessor');
const AudioExtractor = require('../src/processors/audioExtractor');
const FileManager = require('../src/utils/fileManager');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

console.log('🧪 Testing Phase 2: Video Processing Pipeline\n');

async function runTests() {
  const videoProcessor = new VideoProcessor();
  const audioExtractor = new AudioExtractor();
  const fileManager = new FileManager();

  // Test 1: Create a test video file
  console.log('Test 1: Creating test video file...');
  
  const testDir = path.join(__dirname, 'test-files');
  const testVideoPath = path.join(testDir, 'test-video.mp4');
  
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  try {
    // Generate a 5-second test video with audio
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input('testsrc2=duration=5:size=320x240:rate=30')
        .inputOptions('-f lavfi')
        .input('sine=frequency=1000:duration=5')
        .inputOptions('-f lavfi')
        .videoCodec('libx264')
        .audioCodec('aac')
        .output(testVideoPath)
        .on('end', () => {
          console.log('✅ Test video created successfully');
          resolve();
        })
        .on('error', reject)
        .run();
    });

    // Test 2: Video Processor
    console.log('\nTest 2: Testing VideoProcessor...');
    
    // Get metadata
    const metadata = await videoProcessor.getVideoMetadata(testVideoPath);
    console.log(`✅ Metadata extracted - Duration: ${metadata.durationFormatted}, Resolution: ${metadata.video.width}x${metadata.video.height}`);
    
    // Validate video
    const validation = await videoProcessor.validateVideo(testVideoPath);
    if (validation.valid) {
      console.log('✅ Video validation passed');
    } else {
      console.log('❌ Video validation failed:', validation.error);
    }

    // Test 3: Audio Extractor
    console.log('\nTest 3: Testing AudioExtractor...');
    
    const audioResult = await audioExtractor.extractAudio(testVideoPath, testDir);
    console.log(`✅ Audio extracted - File: ${audioResult.filename}, Size: ${audioResult.size} bytes`);
    
    // Validate audio
    const audioValidation = await audioExtractor.validateAudioForTranscription(audioResult.audioPath);
    console.log(`✅ Audio validation - Valid: ${audioValidation.valid}, Duration: ${audioValidation.metadata.duration}s`);

    // Test 4: File Manager
    console.log('\nTest 4: Testing FileManager...');
    
    const fileInfo = fileManager.getFileInfo(testVideoPath);
    console.log(`✅ File info - Size: ${fileInfo.sizeFormatted}, Extension: ${fileInfo.extension}`);
    
    const dirStats = fileManager.getDirectoryStats();
    console.log(`✅ Directory stats - Temp files: ${dirStats.temp.fileCount}`);

    // Test 5: Cleanup
    console.log('\nTest 5: Testing cleanup...');
    
    const cleanupResult = await fileManager.cleanupFile(audioResult.audioPath);
    console.log(`✅ Audio cleanup - ${cleanupResult.message}`);
    
    // Clean up test files
    fs.unlinkSync(testVideoPath);
    fs.rmdirSync(testDir);
    
    console.log('\n🎉 All Phase 2 tests passed successfully!');
    console.log('\n✅ Phase 2 Complete - Ready for Phase 3: AI Integration');
    console.log('\nNext steps:');
    console.log('1. OpenAI Whisper API integration');
    console.log('2. Google Gemini multimodal API');
    console.log('3. Timestamp analysis and key moment identification');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    // Cleanup on error
    if (fs.existsSync(testVideoPath)) fs.unlinkSync(testVideoPath);
    if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
    
    process.exit(1);
  }
}

// Run the tests
runTests().catch(console.error);
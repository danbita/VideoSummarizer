const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

console.log('🧪 Testing FFmpeg Integration...\n');

// Test 1: Check if FFmpeg is available
console.log('Test 1: Checking FFmpeg availability...');
ffmpeg.getAvailableFormats((err, formats) => {
  if (err) {
    console.error('❌ FFmpeg not found:', err.message);
    process.exit(1);
  }
  
  console.log('✅ FFmpeg is available!');
  console.log(`📦 Found ${Object.keys(formats).length} available formats`);
  
  // Test 2: Create a simple test audio file and convert it
  console.log('\nTest 2: Creating test audio conversion...');
  
  // Create directories if they don't exist
  const testDir = path.join(__dirname, 'test-files');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // Generate a test tone (1 second, 440Hz)
  const inputFile = path.join(testDir, 'test-input.mp3');
  const outputFile = path.join(testDir, 'test-output.wav');
  
  // Create a test tone using FFmpeg
  ffmpeg()
    .input('anullsrc=channel_layout=mono:sample_rate=8000')
    .inputOptions(['-f lavfi', '-t 1'])
    .audioCodec('libmp3lame')
    .save(inputFile)
    .on('start', (commandLine) => {
      console.log('🎵 Generating test audio file...');
    })
    .on('end', () => {
      console.log('✅ Test audio file created!');
      
      // Now test conversion from MP3 to WAV
      console.log('🔄 Converting MP3 to WAV...');
      
      ffmpeg(inputFile)
        .toFormat('wav')
        .save(outputFile)
        .on('start', (commandLine) => {
          console.log('Command:', commandLine);
        })
        .on('progress', (progress) => {
          console.log('Progress:', Math.round(progress.percent || 0) + '%');
        })
        .on('end', () => {
          console.log('✅ Conversion completed successfully!');
          
          // Check if output file exists
          if (fs.existsSync(outputFile)) {
            const stats = fs.statSync(outputFile);
            console.log(`📁 Output file size: ${stats.size} bytes`);
            
            // Clean up test files
            fs.unlinkSync(inputFile);
            fs.unlinkSync(outputFile);
            fs.rmdirSync(testDir);
            
            console.log('\n🎉 All FFmpeg tests passed!');
            console.log('✅ Ready for video processing');
          } else {
            console.error('❌ Output file was not created');
            process.exit(1);
          }
        })
        .on('error', (err) => {
          console.error('❌ Conversion failed:', err.message);
          process.exit(1);
        });
    })
    .on('error', (err) => {
      console.error('❌ Failed to create test audio:', err.message);
      process.exit(1);
    });
});

// Test 3: Check FFmpeg codecs
console.log('\nTest 3: Checking available codecs...');
ffmpeg.getAvailableCodecs((err, codecs) => {
  if (err) {
    console.error('❌ Could not get codecs:', err.message);
    return;
  }
  
  const importantCodecs = ['libx264', 'libmp3lame', 'aac', 'libvorbis'];
  console.log('🔍 Checking for important codecs:');
  
  importantCodecs.forEach(codec => {
    if (codecs[codec]) {
      console.log(`  ✅ ${codec}: ${codecs[codec].description}`);
    } else {
      console.log(`  ⚠️  ${codec}: Not available`);
    }
  });
});
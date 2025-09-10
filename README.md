# FV Video Summarizer

An AI-powered video summarization system that automatically extracts key moments from screen recordings and creates condensed summary videos.

## What it does

Upload a screen recording → Get an intelligent summary video that skips boring parts and preserves only essential workflow moments.

- **Detects key moments** using AI analysis of video + audio
- **Automatically skips** loading screens, waiting periods, and repetitive actions
- **Creates summary videos** with 60-80% time reduction
- **Preserves workflow context** and important decision points

## Quick Start

### Prerequisites

- Docker and Docker Compose
- OpenAI API key (for transcription)
- Google AI API key (for video analysis)

### Setup

1. Clone the repository
2. Create `.env` file:
```bash
OPENAI_API_KEY=your_openai_key_here
GOOGLE_AI_API_KEY=your_google_ai_key_here
```

3. Start the system:
```bash
docker-compose up --build
```

### Usage

**Complete pipeline (upload → summary):**
```bash
curl -X POST -F "video=@your_video.mp4" \
  http://localhost:3000/process-and-summarize
```

**Download your summary:**
Visit `http://localhost:3000/output/summary_[jobId].mp4`

## API Endpoints

### Main Workflows

- `POST /process-and-summarize` - Complete pipeline from upload to summary
- `POST /process-full` - AI analysis only (no video summary)
- `POST /quick-summary/:jobId` - Fast summary with defaults
- `POST /create-summary/:jobId` - Custom summary with options

### Utilities

- `GET /summary-options` - View customization options
- `GET /summary/:jobId` - Get summary results
- `POST /cleanup/:jobId` - Clean up temporary files
- `GET /health` - System status

## Example Output

**Input:** 2:07 screen recording (30MB)
**Output:** 52-second summary video (6MB)
**Compression:** 59% time reduction

**Detected moments:**
- Fantasy Football Team Review (6s)
- Box Score Analysis (26s) 
- Trade Decision (5s)
- Email Check (10s)

## Customization Options

```json
{
  "maxMoments": 5,
  "minImportance": 6,
  "composition": {
    "enableTransitions": false,
    "qualityPreset": "medium",
    "crf": 23
  }
}
```

## Technology Stack

- **Video Processing:** FFmpeg for extraction and composition
- **AI Analysis:** OpenAI Whisper + Google Gemini 1.5 Pro
- **Backend:** Node.js with Express
- **Storage:** Local file system with automatic cleanup

## File Limits

- **Video size:** Up to 100MB upload, 2GB processing
- **Duration:** No strict limits (tested up to 10+ minutes)
- **Formats:** MP4, MOV, AVI, MKV, WebM

## System Requirements

- 4GB+ RAM recommended
- 10GB+ free disk space for processing
- Docker environment

## Directory Structure

```
fv-video-summarizer/
├── src/
│   ├── index.js              # Main API server
│   ├── processors/           # Video processing classes
│   ├── ai/                   # AI services
│   └── utils/                # Utilities
├── uploads/                  # User uploaded videos
├── output/                   # Final summary videos
├── segments/                 # Individual moment clips
├── temp/                     # Processing files
└── logs/                     # Activity logs
```

## Troubleshooting

**No moments detected:**
- Ensure video has clear audio narration
- Try lowering `minImportance` threshold
- Check video contains distinct workflow phases

**Processing fails:**
- Verify API keys are configured
- Check video file isn't corrupted
- Ensure sufficient disk space

**Large file issues:**
- Files over 100MB need direct placement in temp/
- Very long videos may exceed API limits

## Development

The system is built in 4 phases:
1. **Video Processing** - Validation, metadata, audio extraction
2. **File Management** - Storage, logging, cleanup
3. **AI Analysis** - Transcription and moment detection  
4. **Video Summarization** - Segmentation and composition

Each phase can be used independently through separate API endpoints.

## License

MIT License - see LICENSE file for details.
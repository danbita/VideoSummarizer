const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

class MomentAnalyzer {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
  }

  async analyzeKeyMoments(videoPath, transcription) {
    try {
      console.log('Starting Gemini 1.5 Pro video analysis...');
      
      // Read video file
      const videoData = fs.readFileSync(videoPath);
      const videoBase64 = videoData.toString('base64');
      
      // Enhanced prompt for more liberal moment detection
      const prompt = `You are an AI video analyst tasked with identifying key moments in user-generated content.

Your goal is to extract meaningful workflow segments and information displays, even from continuous narratives.

VIDEO TRANSCRIPT WITH TIMESTAMPS:
${transcription.text}

DETAILED TRANSCRIPT SEGMENTS:
${transcription.segments ? transcription.segments.map(s => 
  `${this.formatTimestamp(s.start)}-${this.formatTimestamp(s.end)}: ${s.text}`
).join('\n') : 'No segments available'}

ANALYSIS REQUIREMENTS:
Identify 3-8 key moments representing distinct workflow phases or information displays. For continuous screen recordings with narration, treat each major topic or screen transition as a potential moment.

WORKFLOW-BASED MOMENT DETECTION:
For screen recordings with continuous narration, identify moments based on:
- **Topic transitions** (switching between different subjects or interfaces)
- **Information displays** (showing results, data, or status updates)  
- **Workflow phases** (reviewing → analyzing → checking → planning)
- **Interface changes** (moving between different apps or sections)
- **Decision points** (accepting/rejecting actions, making choices)
- **Content reviews** (examining different data sets or items)

LIBERAL MOMENT CRITERIA:
- Each distinct topic or workflow phase should be considered a moment
- Moments can be 10-40 seconds long for workflow segments
- Include transitions even if they flow continuously
- Preserve natural workflow boundaries (when user shifts focus)
- For videos over 90 seconds, aim for at least 4-6 moments
- For videos over 60 seconds, aim for at least 3-4 moments

FOCUS ON THESE CONTENT TYPES:
- **Data review segments** (examining reports, scores, statistics)
- **Navigation phases** (moving between different interfaces)
- **Content checks** (reviewing emails, messages, documents)
- **Decision moments** (making choices, rejecting/accepting items)
- **Information gathering** (looking up different types of data)
- **Planning segments** (reviewing schedules, making plans)

MOMENT SELECTION STRATEGY:
- Identify natural topic boundaries in the narration
- Look for phrases like "let's look at", "we can see", "moving to", "checking"
- Include segments where different types of information are displayed
- Preserve the logical flow of the user's workflow
- Don't skip segments just because they're part of continuous narration

RESPONSE FORMAT (JSON ONLY):
{
  "keyMoments": [
    {
      "title": "Descriptive workflow phase title (max 60 chars)",
      "description": "Clear description of the workflow step or information shown",
      "startTime": 12.5,
      "endTime": 25.3,
      "importance": 7,
      "category": "workflow_phase|data_review|navigation|decision|information_display|planning",
      "reason": "Why this workflow segment is valuable to preserve",
      "workflowContext": "How this fits into the overall user workflow"
    }
  ],
  "summary": "Overview of the complete workflow demonstrated in the video",
  "totalOriginalDuration": ${transcription.duration || 0},
  "recommendedApproach": "Strategy for preserving the essential workflow while improving pacing",
  "contentType": "screen_recording|tutorial|workflow_demo|review_session|other",
  "workflowPhases": "Brief description of the main workflow phases identified"
}

CRITICAL REQUIREMENTS:
- All timestamps must be in decimal seconds format (0 to ${transcription.duration || 0})
- Ensure startTime < endTime for every moment
- For continuous workflows, identify at least one moment per major topic/phase
- Preserve the logical sequence of the user's workflow
- Focus on information value rather than just "exciting" moments
- If the video shows a multi-step process, capture each significant step
- For screen recordings over 60 seconds, ensure at least 3 moments are identified

LIBERAL DETECTION OVERRIDE:
If you initially think there are no distinct moments, reconsider the content as a workflow demonstration and identify the natural phases or topic transitions present in the narration and visual content.

Analyze both the visual content and transcript to identify meaningful workflow segments that would help someone understand the process quickly.`;

      const result = await this.model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'video/mp4',
            data: videoBase64
          }
        }
      ]);

      const response = await result.response;
      const analysisText = response.text();
      
      console.log('Raw Gemini response:', analysisText);
      
      // Enhanced parsing with multiple fallback strategies
      return this.parseGeminiResponse(analysisText, transcription);
      
    } catch (error) {
      console.error('Gemini analysis error:', error);
      return this.createFallbackAnalysis(transcription);
    }
  }

  parseGeminiResponse(responseText, transcription) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const analysis = JSON.parse(jsonMatch[0]);
      
      // Validate and enhance the analysis
      if (!analysis.keyMoments || analysis.keyMoments.length === 0) {
        console.log('No moments detected by AI, applying liberal fallback...');
        return this.createLiberalFallback(transcription, analysis);
      }

      console.log('Before validation - moments count:', analysis.keyMoments.length);
      console.log('Video duration from transcription:', transcription.duration);
      console.log('Total duration from transcription:', transcription.totalDuration);
      console.log('AI estimated duration:', analysis.totalOriginalDuration);
      
      // Get duration from transcription or fallback to AI estimate
      const videoDuration = transcription.duration || transcription.totalDuration || analysis.totalOriginalDuration || 300; // 5min fallback
      console.log('Final duration being used:', videoDuration);
      
      // Validate timestamps and fix any issues
      analysis.keyMoments = analysis.keyMoments.filter((moment, index) => {
        // Fix malformed timestamps (some AI responses use 1.01 instead of 61.0)
        if (moment.startTime < 10 && moment.startTime > 1) {
          moment.startTime = moment.startTime * 60; // Convert to seconds
        }
        if (moment.endTime < 10 && moment.endTime > 1) {
          moment.endTime = moment.endTime * 60; // Convert to seconds
        }
        
        const isValid = moment.startTime >= 0 && 
                       moment.endTime <= videoDuration && 
                       moment.startTime < moment.endTime;
        
        console.log(`Moment ${index} validation:`, {
          title: moment.title,
          startTime: moment.startTime,
          endTime: moment.endTime,
          videoDuration: videoDuration,
          isValid: isValid,
          endTimeCheck: moment.endTime <= videoDuration
        });
        
        return isValid;
      });

      console.log('After validation - moments count:', analysis.keyMoments.length);

      // Calculate total moment duration
      const totalMomentDuration = analysis.keyMoments.reduce((sum, moment) => {
        return sum + (moment.endTime - moment.startTime);
      }, 0);

      // Ensure all required properties exist - force set them
      analysis.recommendedSummaryDuration = Math.round(totalMomentDuration);
      analysis.compressionRatio = transcription.duration 
        ? Math.round((totalMomentDuration / transcription.duration) * 100)
        : 0;
      analysis.momentCount = analysis.keyMoments.length;

      console.log('Analysis properties set:', {
        recommendedSummaryDuration: analysis.recommendedSummaryDuration,
        compressionRatio: analysis.compressionRatio,
        momentCount: analysis.momentCount,
        totalMomentDuration: totalMomentDuration
      });

      return {
        success: true,
        analysis: analysis,
        provider: 'gemini-1.5-pro'
      };

    } catch (error) {
      console.error('Failed to parse Gemini response:', error);
      return this.createLiberalFallback(transcription);
    }
  }

  createLiberalFallback(transcription, aiAnalysis = null) {
    console.log('Creating liberal fallback analysis based on transcript patterns...');
    
    const moments = [];
    const segments = transcription.segments || [];
    const duration = transcription.duration || 0;
    
    // Liberal moment detection based on transcript analysis
    const topicIndicators = [
      'look at', 'we can see', 'going to look', 'can also look',
      'check', 'checking', 'review', 'reviewing',
      'move to', 'moving to', 'switch to', 'go to',
      'here we have', 'this shows', 'you can see',
      'another', 'also', 'next', 'now'
    ];
    
    let currentMomentStart = 0;
    let lastMomentEnd = 0;
    
    segments.forEach((segment, index) => {
      const text = segment.text.toLowerCase();
      const hasTopicIndicator = topicIndicators.some(indicator => text.includes(indicator));
      
      // Look for natural breakpoints or topic changes
      if (hasTopicIndicator || (segment.start - lastMomentEnd > 15)) {
        // Create moment from previous segment
        if (lastMomentEnd < segment.start - 5) {
          const title = this.generateMomentTitle(segments, Math.floor(currentMomentStart), Math.floor(segment.start));
          moments.push({
            title: title,
            description: `Workflow segment: ${title.toLowerCase()}`,
            startTime: Math.max(0, currentMomentStart),
            endTime: Math.min(duration, segment.start),
            importance: 6,
            category: 'workflow_phase',
            reason: 'Natural workflow transition point identified',
            workflowContext: 'Part of continuous user workflow'
          });
          currentMomentStart = segment.start;
          lastMomentEnd = segment.start;
        }
      }
    });

    // Add final moment
    if (currentMomentStart < duration - 10) {
      const title = this.generateMomentTitle(segments, Math.floor(currentMomentStart), Math.floor(duration));
      moments.push({
        title: title,
        description: `Final workflow segment: ${title.toLowerCase()}`,
        startTime: currentMomentStart,
        endTime: duration,
        importance: 6,
        category: 'workflow_phase',
        reason: 'Final workflow segment',
        workflowContext: 'Conclusion of user workflow'
      });
    }

    // Ensure minimum moments for longer videos
    if (moments.length < 3 && duration > 60) {
      const segmentLength = duration / 3;
      moments.length = 0; // Clear and create equal segments
      
      for (let i = 0; i < 3; i++) {
        const start = i * segmentLength;
        const end = Math.min((i + 1) * segmentLength, duration);
        const title = this.generateMomentTitle(segments, Math.floor(start), Math.floor(end));
        
        moments.push({
          title: title,
          description: `Workflow phase ${i + 1}: ${title.toLowerCase()}`,
          startTime: start,
          endTime: end,
          importance: 5 + i,
          category: 'workflow_phase',
          reason: 'Temporal workflow division',
          workflowContext: `Phase ${i + 1} of user workflow`
        });
      }
    }

    return {
      success: true,
      analysis: {
        keyMoments: moments,
        summary: aiAnalysis?.summary || `Liberal analysis of ${Math.round(duration)}s workflow recording with ${moments.length} phases identified`,
        totalOriginalDuration: duration,
        recommendedApproach: 'Preserve all workflow phases with liberal moment detection',
        contentType: 'screen_recording',
        workflowPhases: `${moments.length} workflow phases identified through liberal analysis`
      },
      provider: 'liberal-fallback'
    };
  }

  generateMomentTitle(segments, startTime, endTime) {
    // Find relevant segments for this time range
    const relevantSegments = segments.filter(s => 
      s.start >= startTime && s.end <= endTime
    );
    
    if (relevantSegments.length === 0) return 'Workflow Segment';
    
    // Extract key topics from the text
    const text = relevantSegments.map(s => s.text).join(' ').toLowerCase();
    
    if (text.includes('fantasy') && text.includes('football')) return 'Fantasy Football Review';
    if (text.includes('email')) return 'Email Check';
    if (text.includes('trade')) return 'Trade Decision';
    if (text.includes('bench')) return 'Bench Analysis';
    if (text.includes('team')) return 'Team Performance';
    if (text.includes('class') || text.includes('plan')) return 'Class Planning';
    if (text.includes('game')) return 'Game Results';
    if (text.includes('points')) return 'Score Review';
    
    return 'Workflow Activity';
  }

  formatTimestamp(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
  }

  validateAnalysis(analysis, transcription) {
    const issues = [];
    const recommendations = [];
    let confidence = 0;
    let qualityScore = 0;

    if (!analysis || !analysis.keyMoments) {
      issues.push('No analysis data provided');
      return {
        valid: false,
        issues,
        recommendations: ['Retry analysis with different parameters'],
        confidence: 0,
        qualityScore: 0
      };
    }

    const moments = analysis.keyMoments;
    const duration = transcription.duration || 0;

    // Check for moments
    if (moments.length === 0) {
      issues.push('No key moments identified');
      recommendations.push('Consider lowering moment detection threshold');
      confidence = 0;
    } else {
      confidence = Math.min(100, moments.length * 15);
      qualityScore = Math.min(100, moments.length * 12 + (moments.reduce((sum, m) => sum + (m.importance || 5), 0) / moments.length) * 8);
    }

    // Validate timestamps
    let timestampIssues = 0;
    moments.forEach((moment, index) => {
      if (!moment.startTime || !moment.endTime) {
        issues.push(`Moment ${index + 1} missing timestamps`);
        timestampIssues++;
      } else if (moment.startTime >= moment.endTime) {
        issues.push(`Moment ${index + 1} has invalid time range`);
        timestampIssues++;
      } else if (moment.endTime > duration) {
        issues.push(`Moment ${index + 1} exceeds video duration`);
        timestampIssues++;
      }
    });

    // Check coverage
    const totalMomentDuration = moments.reduce((sum, m) => sum + (m.endTime - m.startTime), 0);
    const coverageRatio = totalMomentDuration / duration;
    
    if (coverageRatio < 0.3 && duration > 60) {
      recommendations.push('Consider including more content to improve coverage');
    }

    // Quality recommendations
    if (moments.length < 3 && duration > 90) {
      recommendations.push('Consider identifying more moments for longer videos');
    }

    if (timestampIssues === 0 && moments.length > 0) {
      qualityScore = Math.max(qualityScore, 70);
    }

    return {
      valid: issues.length === 0,
      issues,
      recommendations,
      confidence,
      qualityScore,
      coverage: Math.round(coverageRatio * 100),
      momentCount: moments.length
    };
  }

  createFallbackAnalysis(transcription) {
    return {
      success: false,
      analysis: {
        keyMoments: [],
        summary: 'AI analysis failed, no moments could be identified',
        totalOriginalDuration: transcription.duration || 0,
        recommendedApproach: 'Manual review recommended',
        contentType: 'unknown'
      },
      provider: 'fallback',
      error: 'AI analysis completely failed'
    };
  }
}

module.exports = MomentAnalyzer;
# 📁 File Naming & Organization Optimization Proposal

## 🎯 **Current Issues:**
1. **Generic filenames**: `clip-00-1753150432158.mp4`
2. **Long paths**: Hard to navigate in R2 console
3. **No titles**: Can't identify clips by filename
4. **Timestamp-based**: Not user-friendly

## ✅ **Proposed Solution:**

### **1. Enhanced File Naming**
```bash
# Current
clip-00-1753150432158.mp4

# Proposed
my-hot-take-on-the-industry-no-one-talks-about-this--viral-10--49s.mp4
```

### **2. Simplified Path Structure**
```bash
# Current
users-data/userId/2025/01/pipeline-pipelineId/result-remotion/clip-00-timestamp.mp4

# Proposed
clips/userId/pipelineId/my-hot-take-on-the-industry--viral-10--49s.mp4
```

### **3. Implementation**

**Function to generate clean filenames:**
```typescript
function generateClipFilename(clip: any, index: number): string {
  // Clean title: remove special chars, limit length
  const cleanTitle = clip.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .substring(0, 50); // Limit to 50 chars

  // Add metadata
  const viralScore = `viral-${clip.viral_score}`;
  const duration = `${Math.round(clip.duration)}s`;
  
  return `${cleanTitle}--${viralScore}--${duration}.mp4`;
}

// Example outputs:
// "my-hot-take-on-the-industry-no-one-talks-about-this--viral-10--49s.mp4"
// "how-i-healed-my-trauma-through-work-raw-real--viral-9--36s.mp4"
```

**Update SQS message generation:**
```typescript
// In queueRemotionRenderSimple function
const filename = generateClipFilename(clip, clip.clip_index);
const outputKey = `clips/${userId}/${pipelineId}/${filename}`;
```

## 📊 **Benefits:**
- ✅ **Recognizable**: Titles visible in filename
- ✅ **Organized**: Cleaner folder structure  
- ✅ **Searchable**: Easy to find specific clips
- ✅ **Professional**: Better for sharing/downloads
- ✅ **Metadata**: Viral score & duration visible

## 🔄 **Migration Strategy:**
1. **New clips**: Use new naming immediately
2. **Existing clips**: Keep old paths (no breaking changes)
3. **Gradual transition**: Update over time 
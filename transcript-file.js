const path = require('path');
const { validateId } = require('./shared');

function getTranscriptFileName(noteId, now = new Date()) {
  if (validateId(noteId)) {
    return `transcription_${noteId}.txt`;
  }

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `transcript_${stamp}.txt`;
}

function getTranscriptFilePath(dataLocation, noteId, now = new Date()) {
  return path.join(dataLocation, 'transcriptions', getTranscriptFileName(noteId, now));
}

module.exports = {
  getTranscriptFileName,
  getTranscriptFilePath,
};

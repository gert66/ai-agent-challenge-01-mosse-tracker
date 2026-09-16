# 1. MOSSE Object Tracker

## What is the challenge?
Select one object in the first frame of a video. The software must keep following that same object frame by frame and show where it moves.

## Input available
- Public OpenCV sample video `vtest.avi`
- Synthetic easy tracking video
- Synthetic video with camera motion and temporary occlusion

## What should we see tomorrow?
A polished browser interface with video playback, tracking box, trajectory, confidence/lost status and simple performance metrics.

## Acceptance test
The tracker must work on more than one supplied video and clearly report when tracking is lost or recovered.

## Public background
- OpenCV MOSSE: https://docs.opencv.org/4.x/d0/d20/classcv_1_1legacy_1_1TrackerMOSSE.html
- Perception Test: https://github.com/google-deepmind/perception_test

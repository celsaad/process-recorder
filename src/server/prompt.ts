// Lane A. Prompt and Gemini response schema (D5).
import { Type, type Schema } from "@google/genai";

export const PROMPT: string = `You are turning a screen recording into a manual test script.

The video shows someone completing a business process in a web or desktop application.
Watch the whole video and list every user action needed to repeat the process, in order.

First decide whether the video is a usable screen recording of software being operated.
- If it is not (for example a person talking to a camera, a slideshow with no interaction,
  a blank or unreadable screen), set "isScreenRecording" to false, explain why in one short
  sentence in "rejectionReason", set "processTitle" to "" and return "steps" as [].
- Otherwise set "isScreenRecording" to true and "rejectionReason" to "".

For a usable recording:
- "processTitle": a short imperative name for the whole process, e.g. "Create a purchase order".
- One step per meaningful user action (a click that changes something, choosing a value,
  entering data into a field, submitting). Merge typing into a single field into one step.
  Skip idle mouse movement, scrolling with no purpose and accidental clicks that were undone.
- "action": one imperative sentence naming the control by its visible label, in quotes,
  e.g. "Click 'New Order'" or "Enter 20 in 'Quantity'".
- "description": one or two sentences on how to do it, including the values used.
- "expectedResult": what the application shows after the action succeeds.
- "timestamp": "MM:SS" of the moment just BEFORE the action happens, when the control is
  visible and has not been clicked yet. Timestamps must increase and stay inside the video.
- "box_2d": the bounding box of the control the user interacts with, in that frame, as
  [ymin, xmin, ymax, xmax] integers normalized to 0-1000. Use [] if there is no single control.

Use only what is visible in the video. Do not invent steps, values or labels.`;

/** All fields required, `propertyOrdering` set, `box_2d` an integer array (D5). */
export const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    isScreenRecording: { type: Type.BOOLEAN },
    rejectionReason: { type: Type.STRING },
    processTitle: { type: Type.STRING },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING },
          description: { type: Type.STRING },
          expectedResult: { type: Type.STRING },
          timestamp: { type: Type.STRING, description: "MM:SS, just before the action" },
          box_2d: {
            type: Type.ARRAY,
            items: { type: Type.INTEGER },
            description: "[ymin, xmin, ymax, xmax] in 0-1000, or []",
          },
        },
        required: ["action", "description", "expectedResult", "timestamp", "box_2d"],
        propertyOrdering: ["action", "description", "expectedResult", "timestamp", "box_2d"],
      },
    },
  },
  required: ["isScreenRecording", "rejectionReason", "processTitle", "steps"],
  propertyOrdering: ["isScreenRecording", "rejectionReason", "processTitle", "steps"],
};

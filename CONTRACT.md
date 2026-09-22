# Violation Event JSON Schema

This is the source of truth for violation events:

```json
{
  "sessionId": "string",
  "type": "head_turn_away | second_person_detected | no_face_detected | unauthorized_object | unauthorized_app | usb_device_detected | multiple_displays_detected",
  "severity": "number (1-5)",
  "timestamp": "ISO 8601 string",
  "details": { 
    "confidence": "number, optional", 
    "duration": "number, optional", 
    "object_class": "string, optional" 
  },
  "screenshotPath": "string, optional"
}
```

export const sideCameraLabels = {
    secondary_camera_disconnected: 'Side Camera Disconnected',
    secondary_camera_moved: 'Side Camera Moved',
    secondary_camera_obstructed: 'Side Camera Obstructed'
};
export function violationSourceLabel(source = 'front_camera') {
    return source === 'side_camera' ? 'Side camera' : 'Front camera';
}

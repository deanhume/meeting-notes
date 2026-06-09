# Usage Guide

## Settings

Access settings via the gear icon (⚙) in the sidebar.

### Data Storage Location

You can customize where your data is stored:

1. Click the settings icon
2. Click "Browse..." to select a folder
3. Click "Save & Reload"

The app will restart and use the new location for all data files.

### Theme

Toggle between light and dark themes using the theme toggle button at the bottom of the sidebar. Your preference is automatically saved.

## Keyboard Shortcuts

- `Escape` - Close any open modal
- `Ctrl/Cmd + Enter` - Save in modals (notes, people, questions)
- `Ctrl + B` - Bold (in note editor)
- `Ctrl + I` - Italic (in note editor)

## Troubleshooting

### App won't start
- Check if port 3000 is already in use
- Try deleting `node_modules` and running `npm install` again

### Data not saving
- Check the data location in Settings
- Ensure you have write permissions to the data directory
- Check the console for error messages

### Build fails
- Ensure you have the latest version of Node.js
- Delete `node_modules`, `package-lock.json`, and `dist` folder
- Run `npm install` and try building again
- Make sure your logo is at least 256x256 pixels

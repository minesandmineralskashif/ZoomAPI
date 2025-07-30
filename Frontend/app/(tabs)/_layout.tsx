import React from 'react';
import { View, Button } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-root-toast';

export default function IndexScreen() {
  const handleCopy = () => {
    Clipboard.setString('https://zoom.us/j/123456789');
    Toast.show('Link copied!', {
      duration: Toast.durations.SHORT,
      position: Toast.positions.BOTTOM,
      backgroundColor: 'green',
      textColor: 'white',
    });
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Button title="Copy Zoom Link" onPress={handleCopy} />
    </View>
  );
}

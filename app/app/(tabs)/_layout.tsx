import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, Tabs } from 'expo-router';
import { Pressable } from 'react-native';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { StarknetConnectorProvider } from '../context/StarknetConnector';
import { FocEngineProvider } from '../context/FocEngineConnector';
import { TicTacToeProvider } from '../context/TicTacToeContractConnector';

// You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <StarknetConnectorProvider>
      <FocEngineProvider>
        <TicTacToeProvider>
          <Tabs
            screenOptions={{
              tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
              // Disable the static render of the header on web
              // to prevent a hydration error in React Navigation v6.
              headerShown: useClientOnlyValue(false, true),
            }}>
            <Tabs.Screen
              name="index"
              options={{
                title: 'Play',
                tabBarIcon: ({ color }) => <TabBarIcon name="gamepad" color={color} />,
                headerRight: () => (
                  <Link href="/modal" asChild>
                    <Pressable>
                      {({ pressed }) => (
                        <FontAwesome
                        name="info-circle"
                        size={25}
                        color={Colors[colorScheme ?? 'light'].text}
                        style={{ marginRight: 15, opacity: pressed ? 0.5 : 1 }}
                        />
                      )}
                    </Pressable>
                  </Link>
                ),
              }}
              />
            <Tabs.Screen
              name="two"
              options={{
                title: 'About',
                tabBarIcon: ({ color }) => <TabBarIcon name="info-circle" color={color} />,
              }}
          />
          </Tabs>
        </TicTacToeProvider>
      </FocEngineProvider>
    </StarknetConnectorProvider>
  );
}

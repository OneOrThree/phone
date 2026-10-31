import React, { useMemo } from 'react';
import { Animated, Image, StyleSheet } from 'react-native';
import { assets } from '@/constants/assets';
import { MAGAZINE_UI } from '@/constants/magazineAssets';
import { componentTokens } from '@/design-system/tokens';
import { HARBOR_STEPS, pelicanPose, type harborFrame } from './harborMotion';

const UP = require('@/assets/ota/harbor/pelican-flight-up.png');
const DOWN = require('@/assets/ota/harbor/pelican-flight-down.png');
const DECK_BOOK = require('@/assets/ota/harbor/magazine-deck.png');
const D = componentTokens.harborCutscene.pelican;

export function PelicanDeliveryArt({
  frame,
  progress,
  onLoaded,
  onError,
}: {
  frame: ReturnType<typeof harborFrame>;
  progress: Animated.Value;
  onLoaded: (name: string) => () => void;
  onError: () => void;
}) {
  const pose = useMemo(() => {
    const samples = HARBOR_STEPS.map((t) => pelicanPose(frame, t));
    const at = (key: keyof (typeof samples)[number]) =>
      progress.interpolate({ inputRange: HARBOR_STEPS, outputRange: samples.map((p) => p[key]) });
    return {
      bird: [{ translateX: at('birdX') }, { translateY: at('birdY') }],
      facing: at('facing'),
      rest: at('birdRest'),
      flying: at('birdFlying'),
      up: at('wingUp'),
      down: at('wingDown'),
      tilt: progress.interpolate({
        inputRange: HARBOR_STEPS,
        outputRange: samples.map((p) => `${p.birdTilt}deg`),
      }),
      book: [{ translateX: at('bookX') }, { translateY: at('bookY') }],
      held: at('bookHeld'),
      placed: at('bookPlaced'),
      heldPose: [
        {
          rotate: progress.interpolate({
            inputRange: HARBOR_STEPS,
            outputRange: samples.map((p) => `${p.bookTilt}deg`),
          }),
        },
        {
          skewX: progress.interpolate({
            inputRange: HARBOR_STEPS,
            outputRange: samples.map((p) => `${p.bookSkew}deg`),
          }),
        },
        { scaleX: at('bookScaleX') },
        { scaleY: at('bookScaleY') },
      ],
      deckTilt: progress.interpolate({
        inputRange: HARBOR_STEPS,
        outputRange: samples.map((p) => `${p.bookDeckTilt}deg`),
      }),
    };
  }, [frame, progress]);
  const size = frame.size * D.birdSize;
  const birdBox = { width: size, height: size, left: -size / 2, top: -size * 0.9 };
  return (
    <>
      <Animated.View
        testID="delivery-pelican-position"
        style={[styles.origin, { transform: pose.bird }]}
      >
        <Animated.View
          style={[
            styles.origin,
            { opacity: pose.flying, transform: [{ scaleX: pose.facing }, { rotate: pose.tilt }] },
          ]}
        >
          <Animated.Image
            source={UP}
            testID="delivery-bird-up"
            accessible={false}
            onLoad={onLoaded('bird-up')}
            onError={onError}
            style={[styles.origin, birdBox, { opacity: pose.up }]}
          />
          <Animated.Image
            source={DOWN}
            testID="delivery-bird-down"
            accessible={false}
            onLoad={onLoaded('bird-down')}
            onError={onError}
            style={[styles.origin, birdBox, { opacity: pose.down }]}
          />
        </Animated.View>
        <Animated.View style={[styles.origin, { opacity: pose.rest, transform: [{ scaleX: -1 }] }]}>
          <Image
            source={assets['characters/pelican/npc/idle.png']}
            testID="delivery-bird-rest"
            accessible={false}
            onLoad={onLoaded('bird-rest')}
            onError={onError}
            style={[styles.origin, birdBox]}
          />
        </Animated.View>
      </Animated.View>
      <Animated.View
        testID="delivery-book-position"
        style={[styles.origin, { transform: pose.book }]}
      >
        <Animated.View style={[styles.origin, { opacity: pose.held, transform: pose.heldPose }]}>
          <Image
            source={MAGAZINE_UI.cover}
            testID="delivery-book"
            accessible={false}
            resizeMode="contain"
            onLoad={onLoaded('book')}
            onError={onError}
            style={{
              position: 'absolute',
              left: (-frame.size * D.coverWidth) / 2,
              top: (-frame.size * D.coverHeight) / 2,
              width: frame.size * D.coverWidth,
              height: frame.size * D.coverHeight,
            }}
          />
        </Animated.View>
        <Animated.View
          style={[styles.origin, { opacity: pose.placed, transform: [{ rotate: pose.deckTilt }] }]}
        >
          <Image
            source={DECK_BOOK}
            testID="delivery-book-depth"
            accessible={false}
            onLoad={onLoaded('book-depth')}
            onError={onError}
            style={{
              position: 'absolute',
              left: -frame.size * D.bookDeckSize * D.bookDeckAnchorX,
              top: -frame.size * D.bookDeckSize * D.bookDeckAnchorY,
              width: frame.size * D.bookDeckSize,
              height: frame.size * D.bookDeckSize,
            }}
          />
        </Animated.View>
      </Animated.View>
    </>
  );
}
const styles = StyleSheet.create({ origin: { position: 'absolute', top: 0, left: 0 } });

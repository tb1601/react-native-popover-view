import React, { Component } from 'react';
import { Animated, Easing, EasingFunction, I18nManager, LayoutChangeEvent, StyleSheet, TouchableWithoutFeedback, View, ViewStyle } from 'react-native';
import Arrow, { ArrowProps } from './Arrow';
import { DEBUG, DEFAULT_ARROW_SIZE, DEFAULT_BORDER_RADIUS, FIX_SHIFT, isWeb, styles } from './Constants';
import { computeGeometry, Geometry } from './Geometry';
import { Placement, Point, PopoverProps, Rect, Size } from './Types';
import { getRectForRef } from './Utility';

interface BasePopoverProps extends Omit<PopoverProps, 'displayAreaInsets'> {
  displayArea: Rect;
  showBackground?: boolean;
  fromRect: Rect | null;
  onDisplayAreaChanged: (rect: Rect) => void;
  skipMeasureContent: () => boolean;
}

interface BasePopoverState {
  requestedContentSize: Size | null;
  activeGeom: Geometry | undefined,
  nextGeom: Geometry | undefined,
  showing: boolean;
  animatedValues: {
    scale: Animated.Value,
    translate: Animated.ValueXY,
    fade: Animated.Value,
    translateArrow: Animated.ValueXY
  }
}


export default class BasePopover extends Component<BasePopoverProps, BasePopoverState> {
  state: BasePopoverState = {
    requestedContentSize: null,
    activeGeom: undefined,
    nextGeom: undefined,
    showing: false,
    animatedValues: {
      scale: new Animated.Value(0),
      translate: new Animated.ValueXY(),
      fade: new Animated.Value(0),
      translateArrow: new Animated.ValueXY()
    }
  }

  private _isMounted = false;
  private animating = false;
  private animateOutAfterShow = false;

  private popoverRef = React.createRef<View>();
  private arrowRef = React.createRef<View>();

  private handleChangeTimeout?: ReturnType<typeof setTimeout>;

  debug(line: string, obj?: unknown): void {
    if (DEBUG || this.props.debug)
      console.log(`[${(new Date()).toISOString()}] ${line}${obj ? `: ${JSON.stringify(obj)}` : ''}`);
  }

  componentDidMount() {
    this._isMounted = true;
  }

  componentDidUpdate(prevProps: BasePopoverProps) {
    // Make sure a value we care about has actually changed
    const importantProps = ['isVisible', 'fromRect', 'displayArea', 'verticalOffset', 'offset', 'placement'];
    if (!importantProps.reduce((acc, key) => acc || this.props[key] !== prevProps[key], false))
      return;

    if (this.props.isVisible !== prevProps.isVisible) {
      this.debug(`componentDidUpdate - isVisible changed, now ${this.props.isVisible}`);
      if (!this.props.isVisible) {
        if (this.state.showing) this.animateOut();
        else this.animateOutAfterShow = true;
        this.debug('componentDidUpdate - Hiding popover');
      }
    } else if (this.props.isVisible && prevProps.isVisible) {
      this.debug('componentDidUpdate - isVisible not changed, handling other changes');
      this.handleChange();
    }
  }

  componentWillUnmount() {
    this._isMounted = false;

    if (this.state.showing) {
      this.animateOut();
    }
  }

  measureContent(requestedContentSize: Size): void {
    if (!requestedContentSize.width)
      console.warn(`Popover Warning - Can't Show - The Popover content has a width of 0, so there is nothing to present.`);
    if (!requestedContentSize.height) console.warn(`Popover Warning - Can't Show - The Popover content has a height of 0, so there is nothing to present.`);
    if (this.props.skipMeasureContent()) {
      this.debug(`measureContent - Skipping, waiting for resize to finish`);
      return;
    }

    if (requestedContentSize.width && requestedContentSize.height) {
      if (
        !this.state.requestedContentSize ||
        requestedContentSize.width !== this.state.requestedContentSize.width ||
        requestedContentSize.height !== this.state.requestedContentSize.height
      ) {
        this.debug(`measureContent - new requestedContentSize: ${JSON.stringify(requestedContentSize)} (used to be ${JSON.stringify(this.state.requestedContentSize)})`);
        this.setState({ requestedContentSize }, () => this.handleChange());
      } else {
        this.debug(`measureContent - Skipping, content size did not change`);
      }
    }
  }

  /*
   * Many factors may cause the geometry to change.
   * This function collects all of them, waiting for 200ms after the last change,
   * then takes action, either bringing up the popover or moving it to its new location
   */
  handleChange() {
    if (this.handleChangeTimeout) clearTimeout(this.handleChangeTimeout);

    /*
     * This function will be called again once we have a requested content size,
     * so safe to ignore for now
     */
    if (!this.state.requestedContentSize) {
      this.debug('handleChange - no requestedContentSize, exiting...');
      return;
    }

    this.debug('handleChange - waiting 100ms to accumulate all changes');
    this.handleChangeTimeout = setTimeout(() => {
      const {
        activeGeom,
        animatedValues,
        requestedContentSize
      }: Partial<BasePopoverState> = this.state;
      const {
        arrowSize,
        popoverStyle,
        fromRect,
        displayArea,
        placement,
        onOpenStart,
        arrowShift,
        onPositionChange,
        offset
      } = this.props;

      if (requestedContentSize) {
        this.debug('handleChange - requestedContentSize', requestedContentSize);

        this.debug('handleChange - displayArea', displayArea);
        this.debug('handleChange - fromRect', fromRect);
        if (placement) this.debug('handleChange - placement', placement.toString());

        const geom = computeGeometry({
          requestedContentSize,
          placement,
          fromRect,
          displayArea,
          arrowSize: arrowSize || DEFAULT_ARROW_SIZE,
          popoverStyle,
          arrowShift,
          debug: this.debug.bind(this),
          previousPlacement: this.getGeom().placement,
          offset
        });

        this.setState({ nextGeom: geom, requestedContentSize }, () => {
          if (geom.viewLargerThanDisplayArea.width || geom.viewLargerThanDisplayArea.height) {
            /*
             * If the view initially overflowed the display area,
             * wait one more render cycle to test-render it within
             * the display area to get final calculations for popoverOrigin before show
             */
            this.debug('handleChange - delaying showing popover because viewLargerThanDisplayArea');
          } else if (!activeGeom) {
            this.debug('handleChange - animating in');
            if (onOpenStart) setTimeout(onOpenStart);
            this.animateIn();
          } else if (activeGeom && !Geometry.equals(activeGeom, geom)) {
            const moveTo = new Point(geom.popoverOrigin.x, geom.popoverOrigin.y);
            this.debug('handleChange - Triggering popover move to', moveTo);
            this.animateTo({
              values: animatedValues,
              fade: 1,
              scale: 1,
              translatePoint: moveTo,
              easing: Easing.inOut(Easing.quad),
              geom,
              callback: onPositionChange
            });
          } else {
            this.debug('handleChange - no change');
          }
        });
      }
    }, 100);
  }

  static getPolarity(): -1 | 1 {
    return I18nManager.isRTL ? -1 : 1;
  }

  getGeom(): Geometry {
    const { activeGeom, nextGeom }: Partial<BasePopoverState> = this.state;
    if (activeGeom) return activeGeom;
    if (nextGeom) return nextGeom;
    return new Geometry({
      popoverOrigin: new Point(0, 0),
      anchorPoint: new Point(0, 0),
      placement: Placement.AUTO,
      forcedContentSize: new Size(0, 0),
      viewLargerThanDisplayArea: {
        width: false,
        height: false
      }
    });
  }

  getTranslateOrigin() {
    const { requestedContentSize } = this.state;
    const arrowSize = this.props.arrowSize || DEFAULT_ARROW_SIZE;
    const {
      forcedContentSize,
      viewLargerThanDisplayArea,
      popoverOrigin,
      anchorPoint,
      placement
    } = this.getGeom();

    let viewWidth = 0;
    if (viewLargerThanDisplayArea.width && forcedContentSize?.width)
      viewWidth = forcedContentSize.width;
    else if (requestedContentSize?.width)
      viewWidth = requestedContentSize.width;

    let viewHeight = 0;
    if (viewLargerThanDisplayArea.height && forcedContentSize?.height)
      viewHeight = forcedContentSize.height;
    else if (requestedContentSize?.height)
      viewHeight = requestedContentSize.height;

    const popoverCenter =
      new Point(popoverOrigin.x + (viewWidth / 2), popoverOrigin.y + (viewHeight / 2));

    let shiftHorizontal = anchorPoint.x - popoverCenter.x;
    if ([Placement.LEFT, Placement.RIGHT].includes(placement))
      shiftHorizontal -= arrowSize.height / 2;

    let shiftVertical = anchorPoint.y - popoverCenter.y;
    if ([Placement.TOP, Placement.BOTTOM].includes(placement))
      shiftVertical -= arrowSize.height / 2;

    this.debug('getTranslateOrigin - popoverOrigin', popoverOrigin);
    this.debug('getTranslateOrigin - popoverSize', { width: viewWidth, height: viewHeight });
    this.debug('getTranslateOrigin - anchorPoint', anchorPoint);
    this.debug('getTranslateOrigin - shift', { hoizontal: shiftHorizontal, vertical: shiftVertical });

    return new Point(popoverOrigin.x + shiftHorizontal, popoverOrigin.y + shiftVertical);
  }

  animateOut() {
    if (this.props.onCloseStart) setTimeout(this.props.onCloseStart);

    if (this._isMounted) this.setState({ showing: false });

    this.animateTo({
      values: this.state.animatedValues,
      fade: 0,
      scale: 0,
      translatePoint: this.getTranslateOrigin(),
      callback: () => setTimeout(this.props.onCloseComplete),
      easing: Easing.inOut(Easing.quad),
      geom: this.getGeom()
    });
  }

  animateIn() {
    const { nextGeom } = this.state;
    if (nextGeom !== undefined && nextGeom instanceof Geometry) {
      const values = this.state.animatedValues;

      // Should grow from anchor point
      const translateStart = this.getTranslateOrigin();
      // eslint-disable-next-line
      translateStart.y += FIX_SHIFT // Temp fix for useNativeDriver issue
      values.translate.setValue(translateStart);
      const translatePoint = new Point(nextGeom.popoverOrigin.x, nextGeom.popoverOrigin.y);

      this.animateTo({
        values,
        fade: 1,
        scale: 1,
        translatePoint,
        easing: Easing.out(Easing.back(1)),
        geom: nextGeom,
        callback: () => {
          if (this._isMounted) {
            this.setState({ showing: true });
            if (this.props.debug || DEBUG) {
              setTimeout(() =>
                this.popoverRef.current &&
                getRectForRef(this.popoverRef).then((rect: Rect) => this.debug('animateIn - onOpenComplete - Calculated Popover Rect', rect))
              );
              setTimeout(() =>
                this.arrowRef.current &&
                getRectForRef(this.arrowRef).then((rect: Rect) => this.debug('animateIn - onOpenComplete - Calculated Arrow Rect', rect))
              );
            }
          }
          if (this.props.onOpenComplete) setTimeout(this.props.onOpenComplete);
          if (this.animateOutAfterShow || !this._isMounted) {
            this.animateOut();
            this.animateOutAfterShow = false;
          }
        }
      });
    }
  }

  animateTo(
    args:
    {
      fade: number;
      scale: number;
      translatePoint: Point;
      callback?: () => void;
      easing: EasingFunction;
      values: {
        scale: Animated.Value,
        translate: Animated.ValueXY,
        fade: Animated.Value,
        translateArrow: Animated.ValueXY
      },
      geom: Geometry
    }
  ) {
    const { fade, translatePoint, scale, callback, easing, values, geom } = args;
    const commonConfig = {
      duration: 300,
      easing,
      useNativeDriver: !isWeb,
      ...this.props.animationConfig
    };

    if (this.animating) {
      setTimeout(() => this.animateTo(args), 100);
      return;
    }

    // eslint-disable-next-line
    translatePoint.y = translatePoint.y + FIX_SHIFT // Temp fix for useNativeDriver issue

    if (!fade && fade !== 0) {
      console.log('Popover: Fade value is null');
      return;
    }
    if (!translatePoint) {
      console.log('Popover: Translate Point value is null');
      return;
    }
    if (!scale && scale !== 0) {
      console.log('Popover: Scale value is null');
      return;
    }
    this.animating = true;
    Animated.parallel([
      Animated.timing(values.fade, {
        ...commonConfig,
        toValue: fade
      }),
      Animated.timing(values.translate, {
        ...commonConfig,
        toValue: translatePoint
      }),
      Animated.timing(values.scale, {
        ...commonConfig,
        toValue: scale
      })
    ]).start(() => {
      this.animating = false;
      if (this._isMounted) this.setState({ activeGeom: this.state.nextGeom });
      if (callback) callback();
    });
  }

  render() {
    const {
      animatedValues,
      nextGeom,
      requestedContentSize
    }: Partial<BasePopoverState> = this.state;
    const { popoverStyle } = this.props;
    const arrowSize = this.props.arrowSize || DEFAULT_ARROW_SIZE;
    const geom = this.getGeom();

    const flattenedPopoverStyle = StyleSheet.flatten(popoverStyle);
    const {
      shadowOffset,
      shadowColor,
      shadowOpacity,
      shadowRadius,
      elevation,
      ...otherPopoverStyles
    } = flattenedPopoverStyle;
    const popoverViewStyle = {
      position: 'absolute' as const,
      ...requestedContentSize,
      shadowOffset,
      shadowColor,
      shadowOpacity,
      shadowRadius,
      elevation,
      transform: [
        { translateX: animatedValues.translate.x },
        { translateY: animatedValues.translate.y },
        { scale: animatedValues.scale },
        { perspective: 1000 }
      ],
      ...(shadowOffset
        ? [
          { shadowOffset: {
            width: new Animated.Value(shadowOffset.width),
            height: new Animated.Value(shadowOffset.width)
          } }
        ]
        : [])
    };

    const contentWrapperStyle: ViewStyle = {
      ...styles.popoverContent,
      ...otherPopoverStyles
    };

    /*
     * We want to always use next here, because the we need this to re-render
     * before we can animate to the correct spot for the active.
     */
    if (nextGeom) {
      contentWrapperStyle.maxWidth =
        (nextGeom as Geometry).forcedContentSize.width || undefined;
      contentWrapperStyle.maxHeight =
        (nextGeom as Geometry).forcedContentSize.height || undefined;
    }

    const arrowPositionStyle: ArrowProps['positionStyle'] = {};

    if (geom.placement === Placement.RIGHT || geom.placement === Placement.LEFT) {
      arrowPositionStyle.top = geom.anchorPoint.y - geom.popoverOrigin.y - arrowSize.height;
      if (popoverViewStyle.width) popoverViewStyle.width += arrowSize.height;
      if (geom.placement === Placement.RIGHT) contentWrapperStyle.left = arrowSize.height;
    } else if (geom.placement === Placement.TOP || geom.placement === Placement.BOTTOM) {
      arrowPositionStyle.left = geom.anchorPoint.x - geom.popoverOrigin.x - (arrowSize.width / 2);
      if (popoverViewStyle.height) popoverViewStyle.height += arrowSize.height;
      if (geom.placement === Placement.BOTTOM) contentWrapperStyle.top = arrowSize.height;
    }
    switch (geom.placement) {
      case Placement.TOP: arrowPositionStyle.bottom = 0; break;
      case Placement.BOTTOM: arrowPositionStyle.top = 0; break;
      case Placement.LEFT: arrowPositionStyle.right = 0; break;
      case Placement.RIGHT: arrowPositionStyle.left = 0; break;
      default:
    }

    // Temp fix for useNativeDriver issue
    const backgroundShift = animatedValues.fade.interpolate({
      inputRange: [0, 0.0001, 1],
      outputRange: [0, FIX_SHIFT, FIX_SHIFT]
    });

    const backgroundStyle = {
      ...styles.background,
      transform: [{ translateY: backgroundShift }],
      ...StyleSheet.flatten(this.props.backgroundStyle)
    };

    const containerStyle = {
      ...styles.container,
      opacity: animatedValues.fade
    };

    const backgroundColor = StyleSheet.flatten(popoverStyle).backgroundColor ||
      styles.popoverContent.backgroundColor;

    return (
      <View pointerEvents="box-none" style={[styles.container, { top: -1 * FIX_SHIFT }]}>
        <View
          pointerEvents="box-none"
          style={[styles.container, { top: FIX_SHIFT, flex: 1 }]}
          onLayout={evt => this.props.onDisplayAreaChanged(new Rect(
            evt.nativeEvent.layout.x,
            evt.nativeEvent.layout.y - FIX_SHIFT,
            evt.nativeEvent.layout.width,
            evt.nativeEvent.layout.height
          ))}
        />
        <Animated.View pointerEvents="box-none" style={containerStyle}>
          {this.props.showBackground !== false && (
            <TouchableWithoutFeedback onPress={this.props.onRequestClose}>
              <Animated.View style={backgroundStyle} />
            </TouchableWithoutFeedback>
          )}

          <View pointerEvents="box-none" style={{ top: 0, left: 0 }}>
            <Animated.View style={popoverViewStyle}>
              <View
                ref={this.popoverRef}
                style={contentWrapperStyle}
                onLayout={(evt: LayoutChangeEvent) => {
                  const layout = { ...evt.nativeEvent.layout };
                  setTimeout(
                    () => this._isMounted &&
                      this.measureContent({ width: layout.width, height: layout.height }),
                    10
                  );
                }}>
                {this.props.children}
              </View>
              {geom.placement !== Placement.CENTER &&
                <Arrow
                  ref={this.arrowRef}
                  placement={geom.placement}
                  color={backgroundColor}
                  arrowSize={arrowSize}
                  positionStyle={arrowPositionStyle}
                />
              }
            </Animated.View>
          </View>
        </Animated.View>
      </View>
    );
  }
}
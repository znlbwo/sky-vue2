import { Sky } from '../create-sky';
import { Cloud } from './cloud';
import Moveable, {
  OnClick,
  OnDrag,
  OnDragGroup,
  OnRenderEnd,
  OnResize,
  OnResizeEnd,
  OnResizeGroup,
  OnResizeGroupStart,
  OnResizeStart,
  OnRotate,
  OnRotateGroup,
} from 'moveable';
import { lookUpTopCloudElement, isBackgroundElement } from '../helper';
import {
  n2px,
  hop,
  withCtrlOrShiftKey,
  isEqualArray,
  difference,
} from '../../tool';
import { CLOUD_RENDER_DIRECTIONS } from '../../constants';

export interface MoveablePlugin {
  instance: Moveable;
  createInstance(): void;
  getTarget(event: any): HTMLElement[];
  setTarget(target: HTMLElement[] | null): void;
  updateState(): void;
  [propsName: string]: any;
}

const DIRECTION = {
  '-1,-1': 'nw',
  '0,-1': 'n',
  '1,-1': 'ne',
  '1,0': 'e',
  '1,1': 'se',
  '0,1': 's',
  '-1,1': 'sw',
  '-1,0': 'w',
};

const DEFAULT_RENDER_DIRECTIONS = ['n', 'nw', 'ne', 's', 'se', 'sw', 'e', 'w'];

const toPosition = (cloud: Cloud) => {
  const { top, left, width, height } = cloud;
  const right = left + width;
  const bottom = top + height;

  // 与 moveable getRect 方法返回数据保持一致
  return {
    pos1: [left, top],
    pos2: [right, top],
    pos3: [left, bottom],
    pos4: [right, bottom],
  };
};

export default function createMoveable(sky: Sky) {
  const module: MoveablePlugin = ({} as unknown) as MoveablePlugin;

  module.updateState = () => {
    const { target } = module.instance;
    if (!Array.isArray(target)) return;
    if (target.length === 0) return;

    const [target0] = target;
    const target0Cloud = sky.cloud.findCloudByElement(target0);
    // false -> 背景 | 未知
    const moveable = target0Cloud ? !target0Cloud.lock : false;

    module.instance.draggable = moveable;
    module.instance.resizable = moveable;
    module.instance.rotatable = moveable;
    module.instance.origin = moveable;

    if (target0Cloud) {
      if (target.length > 1) {
        // THINK: configuable?
        module.instance.renderDirections = CLOUD_RENDER_DIRECTIONS;
      } else {
        const target0VM = sky.editor.getBirdVM(target0);
        module.instance.renderDirections =
          target0VM?.skyHooks?.moveable?.renderDirections ??
          DEFAULT_RENDER_DIRECTIONS;
      }
      module.instance.passDragArea = !moveable;
    } else {
      // 背景 | 其它 -> 开启点击穿透
      module.instance.passDragArea = true;
    }

    const className = [];
    if (target0Cloud?.lock) className.push('lock');
    module.instance.className = className.join(' ');
  };

  module.getTarget = event => {
    const { target } = module.instance;
    if (!Array.isArray(target)) return [];

    let newTarget = [...target];

    const isBackground = isBackgroundElement(event.target);
    let targetEl: HTMLElement | null = null;

    if (isBackground) {
      targetEl = event.target;
    } else {
      targetEl = lookUpTopCloudElement(event.target);
      if (!targetEl) return [];
    }

    if (withCtrlOrShiftKey(event)) {
      // 背景
      if (isBackground) return target;
      if (isBackgroundElement(target[0]) && targetEl) return [targetEl];

      const targetCloud = sky.cloud.findCloudByElement(event.target);
      if (!targetCloud) return [];

      // 锁定
      if (targetCloud.lock) return target;
      if (sky.state.targetClouds[0].lock) return target;

      const targetIndex = newTarget.findIndex(t => t === targetEl);

      if (targetIndex < 0) {
        newTarget.push(targetEl as HTMLElement);
      } else {
        newTarget.splice(targetIndex, 1);
      }
    } else {
      newTarget = [targetEl as HTMLElement];
    }

    return newTarget;
  };

  module.setTarget = target => {
    const oldTarget = module.instance.target;

    if (target) {
      if (!Array.isArray(oldTarget)) return;
      if (isEqualArray(target, oldTarget)) return;

      module.instance.target = target;

      const targetClouds = target.map(el =>
        sky.cloud.findCloudById(el.dataset.cloudId),
      );
      sky.state.targetClouds = sky.state.clouds.filter(cloud =>
        targetClouds.includes(cloud),
      );

      sky.cloud.setSelectCloud(null);

      const leaveTargets = difference(oldTarget, target);
      leaveTargets.forEach(target => {
        const vm = sky.editor.getBirdVM(target);
        vm?.skyHooks?.moveable?.onLeaveTarget?.();
      });

      const enterTargets = difference(target, oldTarget);
      enterTargets.forEach(target => {
        const vm = sky.editor.getBirdVM(target);
        vm?.skyHooks?.moveable?.onEnterTarget?.();
      });

      // const mergeTargets = uniq([...target, ...oldTarget]);
      // mergeTargets.forEach(target => {
      //   const vm = this.getBirdVM(target);
      //   if (vm.skyHooks?.moveable?.onChangeTarget) {
      //     vm.skyHooks.moveable.onChangeTarget();
      //   }
      // });

      sky.state.clouds.forEach(cloud => {
        const vm = sky.editor.getBirdVMById(cloud.id);
        vm?.skyHooks?.moveable?.onChangeTarget?.();
      });
    } else {
      module.instance.target = [];

      if (!Array.isArray(oldTarget)) return;

      oldTarget.forEach(target => {
        const vm = sky.editor.getBirdVM(target);
        vm?.skyHooks?.moveable?.onLeaveTarget?.();
      });
    }

    module.updateState();
  };

  const updateElementGuidelines = (): void => {
    const { target } = module.instance;
    if (!Array.isArray(target)) return;

    const rect = module.instance.getRect();
    const topPos = {
      pos1: rect.pos1,
      pos2: rect.pos2,
      pos3: rect.pos3,
      pos4: rect.pos4,
    };
    const guidelines: Cloud[] = [];

    sky.state.clouds.forEach((cloud: Cloud) => {
      const isInside =
        target.findIndex(t => t.dataset.cloudId === cloud.id) >= 0;
      if (isInside) return;

      const pos = toPosition(cloud);
      const distances: number[] = [];

      Object.values(topPos).forEach(topPosValue => {
        Object.values(pos).forEach(posValue => {
          const x = Math.abs(topPosValue[0] - posValue[0]);
          const y = Math.abs(topPosValue[1] - posValue[1]);
          distances.push(Math.sqrt(x * x + y * y));
        });
      });

      const minDistance = Math.min(...distances);
      if (hop(cloud, 'minDistance')) {
        cloud.minDistance = minDistance;
      } else {
        Object.defineProperty(cloud, 'minDistance', {
          value: minDistance,
          writable: true,
        });
      }

      guidelines.push(cloud);
    });

    guidelines.sort((a, b) => {
      return (a.minDistance as number) - (b.minDistance as number);
    });

    module.instance.elementGuidelines = guidelines
      .slice(0, 5)
      .map(cloud => sky.cloud.queryCloudElementById(cloud.id) as HTMLElement);
  };

  const onDrag = (event: OnDrag): void => {
    // console.log('onDrag', event);

    const { target, top, left } = event;

    target.style.top = n2px(top);
    target.style.left = n2px(left);

    const cloud = sky.state.clouds.find(
      cloud => cloud.id === target.dataset.cloudId,
    );
    if (!cloud) return;

    cloud.top = top;
    cloud.left = left;

    updateElementGuidelines();
  };

  const onDragGroup = (event: OnDragGroup): void => {
    event.events.forEach(onDrag);
  };

  const onResizeStart = (event: OnResizeStart): void => {
    const { target, datas, direction } = event;
    const cloud = sky.cloud.findCloudById(target.dataset.cloudId);

    if (!cloud) return;

    datas.targetCloud = cloud;
    datas.startTop = cloud.top;
    datas.startLeft = cloud.left;
    datas.startWidth = cloud.width;
    datas.startHeight = cloud.height;
    datas.isClouds = sky.cloud.isCloudsObject(cloud);

    const targetVM = sky.editor.getBirdVMById(cloud.id);
    datas.targetVM = targetVM;

    module.instance.keepRatio = targetVM?.skyHooks?.moveable?.keepRatio?.includes(
      Reflect.get(DIRECTION, direction.join()),
    );

    targetVM?.skyHooks?.moveable?.onResizeStart?.(event);
  };

  const onResize = (event: OnResize): void => {
    /**
     * nw      n      ne
     * [-1,-1] [0,-1] [1,-1]
     * w              e
     * [-1, 0] [0, 0] [1, 0]
     * sw      s      se
     * [-1, 1] [0, 1] [1, 1]
     */

    // console.log('onResize', event);

    const { target, width, height, drag, datas } = event;

    datas.scale = [width / datas.startWidth, height / datas.startHeight];

    target.style.width = n2px(width);
    target.style.height = n2px(height);

    datas.targetCloud.width = width;
    datas.targetCloud.height = height;

    if (datas.isClouds) {
      (target.firstElementChild as HTMLElement).style.transform = `scale(${datas.scale[0]}, ${datas.scale[1]})`;
      (target.firstElementChild as HTMLElement).style.transformOrigin =
        'left top';
    }

    datas.targetVM?.skyHooks?.moveable?.onResize?.(event);

    onDrag(drag);
  };

  const onResizeEnd = (event: OnResizeEnd): void => {
    const { target, datas } = event;

    const update = (clouds: Cloud[]): void => {
      clouds.forEach(cloud => {
        cloud.top = cloud.top * datas.scale[1];
        cloud.left = cloud.left * datas.scale[0];
        cloud.width = cloud.width * datas.scale[0];
        cloud.height = cloud.height * datas.scale[1];

        const el = sky.cloud.queryCloudElementById(cloud.id);
        if (!el) return;

        el.style.top = n2px(cloud.top);
        el.style.left = n2px(cloud.left);
        el.style.width = n2px(cloud.width);
        el.style.height = n2px(cloud.height);

        if (cloud.clouds) {
          update(cloud.clouds);
        } else {
          const vm = sky.editor.getBirdVMById(cloud.id);
          vm?.skyHooks?.moveable?.onResizeEndInGroup?.(event);
        }
      });
    };

    if (datas.isClouds) {
      (target.firstElementChild as HTMLElement).style.transform = '';
      (target.firstElementChild as HTMLElement).style.transformOrigin = '';

      update(datas.targetCloud.clouds);
    }

    datas.targetVM?.skyHooks?.moveable?.onResizeEnd?.(event);
  };

  const onResizeGroupStart = (event: OnResizeGroupStart): void => {
    event.events.forEach(onResizeStart);

    // THINK: configuable?
    sky.moveable.instance.keepRatio = true;
  };

  const onResizeGroup = (event: OnResizeGroup): void => {
    event.events.forEach(onResize);
  };

  const onRotate = (event: OnRotate): void => {
    const { target, drag, absoluteRotate } = event;
    target.style.transform = drag.transform;

    const cloud = sky.state.clouds.find(
      cloud => cloud.id === target.dataset.cloudId,
    );
    if (!cloud) return;

    cloud.transform = drag.transform;
    cloud.rotate = absoluteRotate;
  };

  const onRotateGroup = (event: OnRotateGroup): void => {
    event.events.forEach(onRotate);
  };

  const onRenderStart = (): void => {
    sky.history.disable = true;
  };

  const onRenderEnd = (event: OnRenderEnd): void => {
    sky.history.disable = false;

    // 点击 dragArea 蒙层不会触发 onDrag
    // 但会触发 onRenderStart 和 onRenderEnd
    // 这种情况下不去添加历史记录
    if (!event.isDrag) return;

    sky.history.unshift();
  };

  const onClickMoveableArea = (event: OnClick): void => {
    // console.log('onClickMoveableArea', event);

    const target = module.getTarget(event.inputEvent);
    module.setTarget(target);

    sky.cloud.setSelectCloud(event.inputEvent);

    const targetVM = sky.editor.getBirdVM(event.inputTarget);
    targetVM?.skyHooks?.moveable?.onClick?.(event.inputEvent);
  };

  module.createInstance = () => {
    const el = sky.vm.$el as HTMLElement;

    (window as any).moveableInstance = module.instance = new Moveable(el, {
      target: [],
      snappable: true,
      snapCenter: true,
      dragArea: true,
      horizontalGuidelines: [0, el.offsetWidth],
      verticalGuidelines: [0, el.offsetHeight],
    });

    module.instance.on('drag', onDrag);
    module.instance.on('dragGroup', onDragGroup);

    module.instance.on('resizeStart', onResizeStart);
    module.instance.on('resize', onResize);
    module.instance.on('resizeEnd', onResizeEnd);
    module.instance.on('resizeGroupStart', onResizeGroupStart);
    module.instance.on('resizeGroup', onResizeGroup);

    module.instance.on('rotate', onRotate);
    module.instance.on('rotateGroup', onRotateGroup);

    module.instance.on('renderStart', onRenderStart);
    module.instance.on('renderEnd', onRenderEnd);
    module.instance.on('renderGroupStart', onRenderStart);
    module.instance.on('renderGroupEnd', onRenderEnd);

    module.instance.on('click', onClickMoveableArea);
    module.instance.on('clickGroup', onClickMoveableArea);

    module.updateState();
  };

  return module;

  // return new Proxy(module, {
  //   get(target, key) {
  //     if (Reflect.has(target, key)) {
  //       return Reflect.get(target, key);
  //     }
  //     return Reflect.get(module.instance, key);
  //   },

  //   set(target, key, value) {
  //     console.log('proxy moveable set', target, key, value);

  //     // if (key === 'target') {
  //     // module.setTarget(value);
  //     // } else
  //     if (Reflect.has(target, key)) {
  //       Reflect.set(target, key, value);
  //     } else {
  //       Reflect.set(target.instance, key, value);
  //     }
  //     return true;
  //   },
  // });
}

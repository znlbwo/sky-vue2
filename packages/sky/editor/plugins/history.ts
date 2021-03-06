import { Sky, SkyState } from '../create-sky';
let historyTimer: number | undefined;

export interface HistoryPlugin {
  stacks: string[];
  pointer: number;
  disable: boolean;
  delay: number;
  unshift(): void;
  back(): void;
  forward(): void;
}

export default function createHistory(sky: Sky) {
  const module: HistoryPlugin = ({
    stacks: [],
    pointer: 0,
    disable: false,
    delay: 500,
  } as unknown) as HistoryPlugin;

  const setPointer = (pointer: number) => {
    module.pointer = pointer;

    const stack: SkyState = JSON.parse(module.stacks[pointer]);
    if (!stack) return;

    /**
     * data 发生任何变更都会新增一条历史记录
     * 回退历史记录会变更 data
     * 但回退历史记录不能新增历史记录
     * 所以要禁止新增历史记录
     */
    module.disable = true;

    sky.state.scale = stack.scale;
    sky.state.clouds = stack.clouds;
    sky.editor.setBackground(stack.background);

    setTimeout(() => {
      const target = stack.targetClouds.map(cloud =>
        sky.cloud.queryCloudElementById(cloud.id),
      );

      sky.moveable.setTarget(target as HTMLElement[]);

      sky.cloud.updateCloudsElementRect(stack.clouds);
      sky.moveable.instance.updateRect();

      // clouds 发生任何改变都会触发添加历史记录
      // 等到数据更新完成之后再允许添加历史记录
      module.disable = false;
    });
  };

  module.unshift = () => {
    if (module.disable) return;

    clearTimeout(historyTimer);

    historyTimer = setTimeout(() => {
      if (module.pointer > 0) {
        module.stacks.splice(0, module.pointer);
      }

      module.stacks.unshift(JSON.stringify(sky.state));

      if (module.pointer > 0) {
        module.pointer = 0;
      }

      const { maxHistoryStack } = sky.options;
      if (maxHistoryStack && module.stacks.length > maxHistoryStack) {
        module.stacks.pop();
      }
    }, module.delay);
  };

  module.back = () => {
    const nextPointer = module.pointer + 1;
    if (nextPointer >= module.stacks.length) return;

    setPointer(nextPointer);
  };

  module.forward = () => {
    const nextPointer = module.pointer - 1;
    if (nextPointer < 0) return;

    setPointer(nextPointer);
  };

  return module;
}

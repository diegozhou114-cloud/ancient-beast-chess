# 暗兽棋 / Ancient Beast Chess

一个 4×5 的古版斗兽暗棋桌面游戏。你执朱方，与墨方 AI 对弈；每回合可翻一枚暗子或移动一枚己方明子。

## 玩法

- 双方各有：人、象、狮、虎、豹、豺、狼、狗、猫、鼠。
- 阶位高者可吃低者，同阶相遇则同归；鼠可吃象，象不能吃鼠。
- 狮可横竖走一步、斜走一步，或横竖跨过一格。
- 猫可上相邻暗子之墙，鼠可钻入相邻暗子之洞；被叠放的暗子在猫鼠移开前无法翻开。

## 开发

```bash
npm install
npm run desktop
```

## 打包

```bash
npm run package:mac  # Apple Silicon macOS DMG
npm run package:win  # Windows x64 免安装 ZIP
```

打包文件输出到 `dist/`。macOS 包为未签名的本地构建，首次打开可能需要在 Finder 中右键选择“打开”。

## 验证

```bash
npm test
npm run build
```

## 许可

[MIT](LICENSE)

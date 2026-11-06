# B 站评论草稿（发在原作者的 dsh-splash-crt 视频下）

配图：`docs/comment-demo.png`（1440×566，318 KB，B 站评论可直接传）

---

## 短版

UP 这个启动闪屏我拿去改成待机屏保了，十分钟没活干就盖上，点一下或者按个键就收，鼠标移动不算。画面全是你原来的，出处和 MIT 都写在 README 顶上了，谢谢 UP 这个画面，太对味 github.com/yuanzephyr920-oss/dsh-idle-crt

## 带细节版

UP 主这个启动闪屏，我拿去做成待机屏保了，来交个作业

改法不复杂：DSH 里十分钟没活干、鼠标键盘也没动，就把这块 CRT 板盖上；点一下或者按个键就收，鼠标移动不算（老式屏保那种一晃就没，设置里能打开）

顺手加了个设置页，阈值、预热、反色节奏、扫描线、底下那行字都能调。还做了点跟别的插件共存的活：更高的浮层会自动叠上去，全屏、弹窗、正在播的视频会让路。画面合成挪到 GPU 了，4060 上 60 帧是满的

画面、着色器、反色扫掠全是你原来的，MIT 和出处写在 README 顶上了。谢谢 UP 这个画面，太对味

github.com/yuanzephyr920-oss/dsh-idle-crt
装：dsh plugin --profile desktop add dsh-idle-crt

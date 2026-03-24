![otoame](./public/images/otoame.jpg)

# OtoAme

OtoAme 是一个一站式乙女游戏文化社区， 提供乙女游戏下载等服务。承诺永久免费, 高质量。为乙女游戏爱好者提供一片净土！

## 项目说明

本程序 Fork 自 https://github.com/KUN1007/kun-touchgal-next ，保留了 upstream-main 分支，并在其基础上对 main 分支进行修改。

修改内容：

- 修改 `package.json` ，移除 `postinstall` 、 `prisma:push` 、 `prisma:generate` 中的 `pnpx` 以固定 prisma 版本
- 移除了调用 Kun GalGame 补丁 API 的功能
- 将项目可见的 `GalGame` 文本和路由替换为 `OtomeGame`，将 `Touchgal 资源盘` 更改为 `OtoAme 资源盘`
- 为游戏条目添加 `官方中文` 的资源类型并重新排序，添加 `PSP` 、 `NS` 和 `PlayStation` SUPPORTED_PLATFORM 选项并重新排序
- 允许发布具有重复 vndb 编号的游戏，获取 vndb company 信息添加 `ng` 和 `in`，而不仅仅获取 `co`
- 为管理员添加`清除空标签`功能
- 删除或更新下载资源时，更新 `patch_resource` 表的 type 字段，添加一键填写 `otoame` 解压码按钮
- 添加游戏画廊功能，支持 NSFW 遮罩，在 `create` 和 `rewrite` 页面支持图片 NSFW 标识、水印、上传、排序等功能。支持先发布游戏，游戏画廊可在后台上传。发布游戏的超时时间延长为 180s
- 用户更新头像自动刷新 Cloudflare 缓存
- 更换 CAPTCHA 主题为女性向，保留签到提示中的 `琥珀` 等 loli 形象（因为还没找到合适的 q 版男角色）
- 在 `create` 和 `rewrite` 页面添加 bangumi 标签一键填写，需要在 `.env` 文件中填写 bangumi api，修改 vndb 编号为可选字段
- 在用户点击游戏页面的 `下载` 按钮时，页面会滚动到资源链接板块，解决窄屏用户点击按钮误以为没反应的问题。
- 在“资源”或“补丁”标签页之间切换并点击“添加资源”时，弹出的创建窗口将会默认选中当前所在的标签页类型。
- 添加 Redis 密码验证
- 首页仅显示 SFW 内容，为 `OtomeGame`、`Tags` 等页面的查询添加 Redis 缓存，提高并发性能
- 升级 Next.js 和 React，解决安全漏洞
- 添加 CI/CD 构建方案，新增 `pnpm deploy:pull` 构建脚本，与服务器本地构建的方案共存。
- 修复 sitemap.xml 的部分日期格式错误。
- 修复了若干 UI 问题。
- 在管理后台添加「为用户发放萌萌点」功能。

项目的更新日志后续会发在 [Telegram 频道](https://t.me/otoame)。

如果您对此改版项目有疑问，请不要去上游仓库反馈，直接在此仓库提 issues 即可。

## 如何运行

### 1.从 GitHub clone 项目并初始化项目

确保本地安装有 Node.js V22, pnpm, PostgreSQL, Redis 环境，参考[🔗如何部署并运行kun-touchgal-next项目](https://www.arnebiae.com/p/galhowto/)

```bash
git clone https://github.com/OtoAme/kun-otoame-next.git
cd kun-otoame-next
pnpm install
```

### 2.配置环境变量

```bash
# 复制示例文件
cp .env.example .env
```

注意检查 `.env` 文件名末尾不能存在空格。按照下方说明编辑 `.env` 的内容。

```env
# 数据库 URL, 我们使用 psql，创建数据库并填写连接信息
KUN_DATABASE_URL = "postgresql://user:password@localhost:5432/otoame?schema=public"

# 网站 URL
KUN_VISUAL_NOVEL_SITE_URL = "https://www.otoame.com"

# 开发环境 URL
NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV = "http://127.0.0.1:3000"
NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD = "https://www.otoame.com"

# 本地 Redis 地址、端口和密码。
# 密码可留空，但可能会给服务器带来安全风险。密码为空时可能需要关闭 Redis 的保护模式。
REDIS_HOST = '127.0.0.1'
REDIS_PORT = '6379'
REDIS_PASSWORD = ''

# jwt 配置, 自行修改，JWT_SECRET 推荐自己随机生成，尽可能复杂，不要用默认的
JWT_ISS = 'otoame'
JWT_AUD = 'otoame_admin'
JWT_SECRET = 'otoamegamewithflosover!chinorensukiazkhx'

# NODE_ENV, 开发环境无需变动，生产环境需要改为 NODE_ENV = "production"
NODE_ENV = "development"
HOSTNAME = "127.0.0.1"

# Bangumi Access Token，用于自动匹配游戏标签
# 申请地址：https://next.bgm.tv/demo/access-token/create
BANGUMI_ACCESS_TOKEN = "kkkkkkkkkkkkkkkkkkkkkkkkkkkk"

# 邮件服务地址
KUN_VISUAL_NOVEL_EMAIL_FROM = "纸月花雨"
KUN_VISUAL_NOVEL_EMAIL_HOST = "otoame.moe"
KUN_VISUAL_NOVEL_EMAIL_PORT = '587'
KUN_VISUAL_NOVEL_EMAIL_ACCOUNT = "auth@otoame.moe"
KUN_VISUAL_NOVEL_EMAIL_PASSWORD = "otoame"

# S3 相关配置
KUN_VISUAL_NOVEL_S3_STORAGE_ACCESS_KEY_ID = "kkkkkkkkkkkkkkkkkkkkkkkkkkkk"
KUN_VISUAL_NOVEL_S3_STORAGE_SECRET_ACCESS_KEY = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk"
KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME = "mio"
KUN_VISUAL_NOVEL_S3_STORAGE_ENDPOINT = "https://example.com"
KUN_VISUAL_NOVEL_S3_STORAGE_REGION = "us-west-001"
NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL = "https://img-test.example.com"

# 图床相关配置，要求与示例格式保持一致
KUN_VISUAL_NOVEL_IMAGE_BED_HOST = "img-test.example.com"
KUN_VISUAL_NOVEL_IMAGE_BED_URL = "https://img-test.example.com"

# Cloudflare 清除缓存相关配置
# "Zone ID"在 Cloudflare 域名概览页面的右下角
KUN_CF_CACHE_ZONE_ID = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk"
# 申请具有 Zone “清除缓存”的 API 令牌填入下方
KUN_CF_CACHE_PURGE_API_TOKEN = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk"

# 替换为你自己随机生成字符串，并在 public 目录下新建一个txt，文件名和内容都是该字符串
KUN_VISUAL_NOVEL_INDEX_NOW_KEY = "a7xmyp2ob6kst9bkkdt2hnhj04rpctzd"

// 禁止搜索引擎爬取测试网站，生产环境中应该删除或者注释掉该行
KUN_VISUAL_NOVEL_TEST_SITE_LABEL = "noindex"

# GitHub 仓库信息 (格式: 用户名/仓库名)
GITHUB_REPO="OtoAme/kun-otoame-next"

# (可选) 如果是私有仓库，需要提供 GitHub Token
# 申请地址: https://github.com/settings/tokens (权限需勾选: repo)
# GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 3.初始化数据库

使用项目内置脚本同步数据库结构：

```bash
pnpm prisma:push
```

### 4.运行本项目

启动开发服务器。启动 dev 需要编译每个页面，编译速度与服务器性能相关

```bash
pnpm dev
```

构建并启动服务

```bash
# 构建项目
pnpm build

# 启动服务
pnpm start
```

本地访问 `http://127.0.0.1:3000`

如果是部署在服务器上，需要先设置反向代理并做好 DNS 解析，之后用域名访问。

Nginx 参考：[🔗安装 Nginx 环境](https://www.arnebiae.com/p/galhowto/#%E5%AE%89%E8%A3%85-nginx-%E7%8E%AF%E5%A2%83)

1Panel 参考:

![1panel反代设置](./public/images/1panel.png)

### 5.注册管理员账户

1. 到网站的注册页面注册一个用户，第一个注册的用户的UID为1，建议给 UID 为 1 的用户超级管理员

2. 回到终端，执行 `npx prisma studio` 并打开 `http://yourip:5555` 进入prisma studio（本地是 `http://localhost:5555` ），将 ID 为 1 的用户的 role 字段设置为 4 ，作用是 ID 为 1 的用户设置为超级管理员。

   系统规定，role 字段为 1 的用户是普通用户，2 为创作者，3 为管理员，4 超级管理员

   注意，这里的 UID 为 1 的用户就是上面注册的那个用户，UID 随用户注册自增

3. 重新进入网站刷新页面，应该已经可以在用户 1 的主页看到用户 1 变为了超级管理员

## 关于项目的更改与构建

### CI/CD 方案

只需将代码推送到 `main` 分支，CI 流水线会自动运行。

GitHub Actions 会自动构建项目，并在 Releases 页面生成一个名为 v2025.xx.xx.xxxx 的新版本，包含 release.tar.gz

构建完毕后，需要手动在服务器端执行 

```bash
pnpm deploy:pull
```

脚本会自动 `git pull` 更新项目源码，从 GitHub 下载最新的 release.tar.gz 构建产物并应用，速度取决于网络，通常仅需几秒。

**🛠️配置向导**

1. GitHub 仓库配置 Environment Secrets

   前往您的 GitHub 仓库 -> **Settings** -> **Environments** -> **buildPublicEnv**（如没有请新建），添加以下 Environment Secrets（用于构建时注入环境变量）：

   | Secret Name                                 | 说明             |
   | ------------------------------------------- | ---------------- |
   | NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV           | 开发环境补丁地址 |
   | NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD          | 生产环境补丁地址 |
   | NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL | S3 存储桶地址    |

   > **注意**：此处配置的变量应与服务器的 `.env` 保持一致。
   >
   > 仅需配置以 `NEXT_PUBLIC_` 开头的变量，因为这些变量会在构建时被打包进前端代码中。私有变量（如数据库密码）仅需存在于服务器的 `.env` 文件中。

2. 登录您的生产服务器，编辑项目根目录下的 `.env` 文件，添加以下配置，以便部署脚本能找到并下载发布包：

   ```env
   # 你的 GitHub 仓库地址 (用户名/仓库名)
   GITHUB_REPO="OtoAme/kun-otoame-next"
   
   # (可选) 如果是私有仓库，需要提供 GitHub Token
   # 申请地址: https://github.com/settings/tokens (权限需勾选: repo)
   # GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   ```

3. 部署完成后，您可以通过以下命令检查服务状态：

   ```sh
   # 查看 PM2 进程状态
   pm2 status
   
   # 查看实时日志
   pm2 logs kun-touchgal-next
   ```



### 服务器本地构建

1. 每次当你对项目做了任何更改，必须重新在服务器的项目根目录运行一遍下面的命令。这会将你的更改应用到项目中，并重新构建项目。

   ````
   pnpm deploy:build
   ````

   

   你也可以不使用内置脚本，手动更新：

   ```bash
   git pull                 # 拉取最新代码
   pnpm install             # 如果依赖有变化
   pnpm prisma:push         # 如果数据库结构有变化
   pnpm build               # 重新构建 (必须!)
   pnpm stop && pnpm start  # 重启服务
   ```

   

2. 构建过程一般在 1 ~ 2 分钟，这个期间网站会有部分功能不可用，正在访问网站的用户不会受到影响

3. 构建完毕之后服务器需要将新生成的文件读取到到内存，CDN 和用户浏览器的缓存也需要刷新，网站速度会短暂变慢直到 CDN 和用户浏览器的缓存与服务器同步

4. 如果构建过程出现爆内存的情况，你需要为服务器添加 swap，并且修改项目根目录 `ecosystem.config.js` 文件中的实例 `instances` 数量，建议设置为服务器 CPU 核数。

   同理如果觉得网站速度还是不够，可以多开几个实例。例如 16 核服务器可建议开 16 个实例，项目会自动进行负载均衡，**但是同时项目对服务器的内存占用也会变成 700MB \* 16**

   ```js
   const path = require('path')
   
   module.exports = {
     apps: [
       {
         name: 'kun-touchgal-next',
         port: 3000,
         cwd: path.join(__dirname),
         instances: 3,
         autorestart: true,
         watch: false,
         max_memory_restart: '1G',
         script: './.next/standalone/server.js',
         // https://nextjs.org/docs/pages/api-reference/config/next-config-js/output
         env: {
           NODE_ENV: 'production',
           HOSTNAME: '127.0.0.1',
           PORT: 3000
         }
       }
     ]
   }
   
   ```

   你可以把这里的 instances 数量改为对应你服务器核数的数字，比如你划出了一个 4c8g 的小鸡，可以把 instances 改为 4，6c12g 则可以把 instances 改为 6

## 严重警告

![warning](./public/images/warning.png)

如果你在运行 `pnpm deploy:build` 或者运行任何其它命令的时候，看到下面的提示消息

```sh
⚠️ We found changes that cannot be executed:
× To apply this change we need to reset the database, do you want to continue? All data will be lost. ... 
no
```

这时，必须连按两下 Ctrl + c 中断操作，或者输入 `n` 以取消操作

#### 千万不要按 y 或者回车，否则，数据库中的所有数据会被全部重置，不可能还原，如果没有备份将会倾家荡产，非常严重

这个是使用 prisma 造成了对数据库不可逆的更改造成的，一般不会有这种情况，如果有会明确告知

## 如何配置网站的信息

网站的信息目前已经配置好，如果需要更改，则必须更改 `config/moyu-moe.ts` 文件

暂时仅建议更改这里的信息，如非必要不要更改这个文件，这涉及到网站全部的名称、链接配置与 SEO 优化

## 如何添加友情链接

在项目的 `config/friend.json` 文件中编写对应的信息即可

## 如何编写项目 /doc 目录的 MDX 文件

参考：[🔗如何编写项目 /doc 目录的 MDX 文件](https://www.arnebiae.com/p/galhowto/#%E5%A6%82%E4%BD%95%E7%BC%96%E5%86%99%E9%A1%B9%E7%9B%AE-doc-%E7%9B%AE%E5%BD%95%E7%9A%84-mdx-%E6%96%87%E4%BB%B6)

## 几个重要的地方说明

1. 自行修改项目代码造成的任何不良后果需要自行承担
2. 网站的 NSFW 文章，用户主页等已经彻底阻止搜索引擎索引，这些文章将会 0 SEO 甚至反 SEO，不会对其它页面产生影响
3. 项目的 uploads 文件夹是用户上传的临时文件，因为怕有的用户上传一半不传了或者传了不发布产生死文件。项目没过 1h 会自动扫描一遍项目中的 uploads 文件夹，删除超过 1 天的死文件
4. 项目占用服务器的内存取决于网站的访问量以及项目的实例数，理论上 300k ~ 400k 月独立 ip 数的网站，使用 pm2 部署，按照目前的配置可以流畅运行，内存占用在 700MB 左右
5. 如果觉得网站速度还是不够，可以看本说明「关于项目的更改与构建」，多开几个实例，实例数取决于服务器的核数，pm2 会利用服务器的核数自动负载均衡

## 日常维护命令

| 动作              | 命令                                                   | 说明                                               |
| :---------------- | :----------------------------------------------------- | :------------------------------------------------- |
| **同步上游**      | `git switch upstream-main` -> `git pull upstream main` | 拉取原作者更新                                     |
| **更新类型**      | `pnpm prisma:generate`                                 | 更新 TS 类型定义                                   |
| **更新数据库**    | `pnpm prisma:push`                                     | 同步结构到 DB                                      |
| **prisma studio** | `npx prisma studio`                                    | 启动 prisma studio                                 |
| **本地运行**      | `pnpm dev`                                             | 开发模式                                           |
| **生产构建**      | `pnpm build`                                           | 生产编译                                           |
| **生产启动**      | `pnpm start`                                           | 项目后台运行                                       |
| **生产停止**      | `pnpm stop`                                            | 项目停止运行                                       |
| **CI/CD 更新**    | `pnpm deploy:pull`                                     | 服务器端拉取 GitHub Actions 构建产物，自动应用更新 |
| **本地一键更新**  | `pnpm deploy:build`                                    | 服务器端本地构建自动更新                           |
| **查看状态**      | `pm2 status`                                           | 查看 PM2 进程状态                                  |
| **查看日志**      | `pm2 logs kun-touchgal-next`                           | 查看实时日志                                       |

## 参考

- [🔗如何部署并运行kun-touchgal-next项目](https://www.arnebiae.com/p/galhowto/)
- [🔗kun-touchgal-next](https://github.com/KUN1007/kun-touchgal-next)


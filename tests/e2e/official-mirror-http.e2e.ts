/** Real HTTP + PostgreSQL acceptance for E06-01/02/04; disposable fixtures only. */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import pg, { type QueryResultRow } from 'pg'
import Redis from 'ioredis'
import { session } from './official-mirror-ui.browser'

const required = (key: string) => { const value = process.env[key]; assert(value, key + ' required'); return value }
const database = new URL(required('KUN_E2E_DATABASE_URL'))
assert.equal(database.hostname, '127.0.0.1')
assert.equal(database.port, '55436')
assert.equal(database.pathname, '/official_mirror_e_ui_e2e')
assert.equal(database.username, 'official_mirror_e')
assert.equal(required('KUN_E2E_REDIS_URL'), 'redis://127.0.0.1:56380')
const origin = required('KUN_E2E_BASE_URL')
assert.equal(origin, 'http://127.0.0.1:3100')
const artifacts = required('KUN_E2E_ARTIFACT_DIR')
const pool = new pg.Pool({ connectionString: database.href, max: 8 })
const redis = new Redis(required('KUN_E2E_REDIS_URL'))
const run = 'oh' + randomBytes(2).toString('hex')
const checks: string[] = []
const pass = (name: string) => { checks.push(name); console.log('PASS ' + name) }
const query = (sql: string, values: unknown[] = []) => pool.query<QueryResultRow>(sql, values)
const dateIso = (value: unknown) => { assert(value instanceof Date); return value.toISOString() }
const int = (value: unknown) => { assert.equal(typeof value, 'number'); assert(Number.isSafeInteger(value)); return value as number }
const api = async (cookie: string, path: string, method = 'GET', input?: unknown) => {
  const response = await fetch(origin + path, { method, headers: { Cookie: cookie, Origin: origin, 'x-requested-with': 'kun-fetch',
    ...(input === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }) })
  return { status: response.status, data: await response.json(), headers: response.headers }
}
const auth = (token: string) => 'kun-galgame-patch-moe-token=' + token
const user = async (suffix: string, role = 1) => (await query(`INSERT INTO public."user"
(name,email,password,role,moemoepoint,enable_email_notice,created,updated)
VALUES ($1,$2,'not-used',$3,40,false,CURRENT_TIMESTAMP - INTERVAL '30 days',CURRENT_TIMESTAMP) RETURNING id`,
[run + suffix, run + suffix + '@example.invalid', role])).rows[0].id as number
let publisher: number, reader: number, follower: number, admin: number, patch: number
let authorCookie: string, readerCookie: string, followerCookie: string, adminCookie: string
const when = (days: number) => new Date(Date.now() - days * 86400000)
const resource = async (suffix: string, owner = publisher, section = 'galgame') => (await query(`INSERT INTO patch_resource
(section,name,note,type,language,platform,status,user_id,patch_id,created,updated)
VALUES ($1,$2,'synthetic acceptance',ARRAY['pc','official-zh']::text[],ARRAY['zh-Hans']::text[],ARRAY['windows']::text[],0,$3,$4,$5,$5) RETURNING id`,
[section, run + suffix, owner, patch, when(8)])).rows[0].id as number
const link = async (id: number, storage = 'user', changed = when(7), content?: string) => (await query(`INSERT INTO patch_resource_link
(storage,content,size,sort_order,resource_id,created,updated,attached_at,content_changed_at)
VALUES ($1,$2,'1 GB',0,$3,$4,$4,$4,$4) RETURNING id`,
[storage, content ?? `https://example.invalid/${run}/${id}/${randomBytes(3).toString('hex')}`, id, changed])).rows[0].id as number
const handover = (id: number, cookie = authorCookie, action = 'handover') => api(cookie, `/api/patch/resource?resourceId=${id}&action=${action}`, 'DELETE')
const caseRow = async (id: number, status: string, kind = 'resource_mismatch', ownerType = 'publisher') => (await query(`INSERT INTO ops_case
(kind,target_type,target_id,patch_id,reporter_id,owner_type,owner_id,status,public,source,revision,status_changed_at,queue_entered_at,closed_at,resolution,updated)
VALUES ($1,'resource',$2,$3,$4,$5,$6,$7,true,'user',1,$8,$8,$9,$10,CURRENT_TIMESTAMP) RETURNING id`,
[kind,id,patch,reader,ownerType,ownerType === 'publisher' ? publisher : null,status,when(1), status === 'resolved' ? when(1) : null, status === 'resolved' ? 'repaired' : null])).rows[0].id as number
const getCount = async (id: number, linkId: number) => (await query(`SELECT r.download AS resource,p.download AS patch,l.download AS link,l.click,l.updated AS link_updated,r.updated AS resource_updated
FROM patch_resource r JOIN patch p ON p.id=r.patch_id JOIN patch_resource_link l ON l.resource_id=r.id WHERE r.id=$1 AND l.id=$2`, [id,linkId])).rows[0]

async function queueFlows() {
  const id = await resource('queue')
  const external = await link(id)
  const list = async (tab: string) => {
    const result = await api(adminCookie, `/api/admin/backup?tab=${tab}&search=${run}&page=1&limit=100`)
    assert.equal(result.status, 200)
    assert(Array.isArray(result.data.items), JSON.stringify(result.data))
    return result.data.items.map((item: { resourceId: number }) => item.resourceId)
  }
  assert((await list('unbacked')).includes(id))
  let backup = await link(id, 'touchgal', when(5))
  assert(!(await list('unbacked')).includes(id))
  assert(!(await list('rebackup')).includes(id))
  await query('UPDATE patch_resource_link SET content=content || $2,content_changed_at=$3 WHERE id=$1', [external,'/changed',when(3)])
  assert((await list('rebackup')).includes(id))
  const detail = async () => (await api(adminCookie, `/api/admin/backup/detail?resourceId=${id}`)).data
  const stale = (await detail()).basis
  await link(id, 'user', when(2))
  const rejected = await api(adminCookie, '/api/admin/backup/dismiss', 'POST', { resourceId:id,basis:stale })
  assert.equal(typeof rejected.data, 'string')
  assert(rejected.data.includes('变化'), JSON.stringify(rejected.data))
  assert.equal((await query('SELECT COUNT(*)::int AS n FROM patch_resource_backup_state WHERE resource_id=$1',[id])).rows[0].n,0)
  const current = (await detail()).basis
  assert((await api(adminCookie,'/api/admin/backup/dismiss','POST',{ resourceId:id,basis:current })).data.changed)
  const first = (await query('SELECT rebackup_dismissed_at FROM patch_resource_backup_state WHERE resource_id=$1',[id])).rows[0].rebackup_dismissed_at
  assert.equal((await api(adminCookie,'/api/admin/backup/dismiss','POST',{ resourceId:id,basis:current })).data.changed,false)
  assert.equal(dateIso((await query('SELECT rebackup_dismissed_at FROM patch_resource_backup_state WHERE resource_id=$1',[id])).rows[0].rebackup_dismissed_at),dateIso(first))
  assert(!(await list('rebackup')).includes(id))
  await query('UPDATE patch_resource_link SET content_changed_at=CURRENT_TIMESTAMP WHERE id=$1',[external])
  assert((await list('rebackup')).includes(id))
  await query('DELETE FROM patch_resource_link WHERE id=$1',[backup])
  assert((await api(adminCookie,'/api/admin/backup/ignore','POST',{ resourceId:id,reason:'synthetic' })).data.changed)
  backup=await link(id,'touchgal',when(5))
  await query('UPDATE patch_resource_link SET content_changed_at=CURRENT_TIMESTAMP WHERE id=$1',[external])
  assert((await list('ignored')).includes(id))
  assert(!(await list('rebackup')).includes(id))
  await api(adminCookie,'/api/admin/backup/unignore','POST',{ resourceId:id })
  assert((await list('rebackup')).includes(id))
  await query("UPDATE patch_resource_link SET content_changed_at=CURRENT_TIMESTAMP + INTERVAL '1 second' WHERE id=$1",[backup])
  assert(!(await list('rebackup')).includes(id))
  await query('DELETE FROM patch_resource_link WHERE id=$1',[backup])
  await api(adminCookie,'/api/admin/backup/ignore','POST',{ resourceId:id })
  backup=await link(id,'touchgal',new Date(Date.now()+2000))
  await api(adminCookie,'/api/admin/backup/unignore','POST',{ resourceId:id })
  assert(!(await list('unbacked')).includes(id))
  assert(!(await list('rebackup')).includes(id))
  const s3 = await resource('s3only'); await link(s3,'s3')
  const staff = await resource('staff',admin); await link(staff)
  assert(!(await list('unbacked')).includes(s3))
  assert(!(await list('unbacked')).includes(staff))
  const noBackup = await resource('candidate'); await link(noBackup)
  assert((await list('unbacked')).includes(noBackup))
  pass('E06-02 real queue enter/exit, ignore precedence, stale dismiss rejection and idempotent watermark')
}

async function handoverFlows() {
  const noBackup = await resource('race-no-backup'); await link(noBackup)
  assert.equal((await handover(noBackup)).status,409)
  assert.equal((await query('SELECT publisher_left_at FROM patch_resource WHERE id=$1',[noBackup])).rows[0].publisher_left_at,null)
  await link(noBackup,'touchgal',when(5))
  assert.equal((await handover(noBackup,authorCookie,'delete')).status,409)
  assert.equal((await query('SELECT COUNT(*)::int AS n FROM patch_resource WHERE id=$1',[noBackup])).rows[0].n,1)
  pass('E06-01 stale handover/delete intent never switches action')

  const id = await resource('handover'); await link(id,'user',when(1)); await link(id,'touchgal',when(3))
  const openCase = await caseRow(id,'open')
  const waiting = await caseRow(id,'waiting_reporter','resource_other')
  const closed = await caseRow(id,'resolved','resource_unpack')
  const timedOut = await caseRow(id,'open','resource_run','staff')
  await query(`INSERT INTO ops_case_message(case_id,kind,event,payload,body) VALUES ($1,'system','escalated',$2,'synthetic timeout')`, [timedOut,JSON.stringify({ escalation_trigger:'publisher_timeout',from_owner_id:publisher })])
  await query(`INSERT INTO ops_case_subscriber(case_id,user_id) VALUES ($1,$2),($3,$4)`,[openCase,follower,waiting,publisher])
  await query(`INSERT INTO ops_case_message(case_id,author_id,kind,body) VALUES ($1,$2,'reply','Synthetic original dialogue')`,[openCase,reader])
  const beforeWaiting = (await query('SELECT status_changed_at FROM ops_case WHERE id=$1',[waiting])).rows[0].status_changed_at
  const ledgerBefore = (await query('SELECT COUNT(*)::int AS n FROM user_moemoepoint_ledger WHERE user_id=$1',[publisher])).rows[0].n
  const liked = await api(readerCookie,'/api/patch/resource/like','PUT',{ resourceId:id })
  assert.equal(liked.status,200)
  const before = (await query('SELECT moemoepoint FROM public."user" WHERE id=$1',[publisher])).rows[0].moemoepoint
  const handed = await handover(id)
  assert.equal(handed.status,200)
  assert.equal(handed.data.action,'handed_over')
  assert.equal((await handover(id)).data.action,'handed_over')
  const resources = await query('SELECT user_id,publisher_left_at FROM patch_resource WHERE id=$1',[id])
  assert.equal(resources.rows[0].user_id,publisher); assert(resources.rows[0].publisher_left_at)
  assert.deepEqual((await query('SELECT storage FROM patch_resource_link WHERE resource_id=$1',[id])).rows.map(row=>row.storage),['touchgal'])
  assert.equal((await query('SELECT COUNT(*)::int AS n FROM admin_log WHERE type=\'resource_handover\' AND content LIKE $1',['资源 '+id+' 已交由站方维护%'])).rows[0].n,1)
  assert.equal((await query('SELECT moemoepoint FROM public."user" WHERE id=$1',[publisher])).rows[0].moemoepoint,before)
  const cases = (await query('SELECT * FROM ops_case WHERE id=ANY($1::int[]) ORDER BY id',[[openCase,waiting,closed]])).rows
  assert.equal(cases[0].owner_type,'staff')
  assert.equal(cases[1].owner_type,'staff'); assert.equal(cases[1].status,'waiting_reporter')
  assert.equal(dateIso(cases[1].status_changed_at),dateIso(beforeWaiting))
  assert.equal(cases[2].status,'resolved')
  const transferred = (await query("SELECT payload FROM ops_case_message WHERE case_id=ANY($1::int[]) AND event='escalated'",[[openCase,waiting]])).rows
  assert.equal(transferred.length,2)
  assert(transferred.every(row=>{ const payload=row.payload; assert(payload && typeof payload==='object'); return 'escalation_trigger' in payload && payload.escalation_trigger==='publisher_left' && !('from_owner_id' in payload) }))
  assert.equal((await query('SELECT COUNT(*)::int AS n FROM ops_case_subscriber WHERE case_id=ANY($1::int[])',[[openCase,waiting]])).rows[0].n,2)
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM ops_case_message WHERE case_id=$1 AND body='Synthetic original dialogue'",[openCase])).rows[0].n,1)
  assert.equal((await handover(id,authorCookie,'delete')).status,403)
  const workspace = await api(authorCookie,`/api/workspace/resources/${id}`)
  assert(workspace.status === 404 || typeof workspace.data === 'string', 'handed-over resource cannot be edited through workspace')
  const timedDetail = await api(authorCookie,`/api/case/${timedOut}`)
  if (typeof timedDetail.data === 'string') assert.equal(timedDetail.data,'无权查看该问题')
  else { assert.equal(typeof timedDetail.data.case?.capabilities?.canResolve,'boolean'); assert.equal(timedDetail.data.case.capabilities.canResolve,false) }
  const independent = await api(authorCookie,`/api/case/${waiting}`)
  assert(independent.data.case,'subscriber identity must remain readable')
  const maintainedLink = (await query('SELECT * FROM patch_resource_link WHERE resource_id=$1',[id])).rows[0]
  const edit = {resourceId:id,patchId:patch,section:'galgame',name:run+'handed-edit',note:'Synthetic admin edit after handover',type:['pc','official-zh'],language:['zh-Hans'],platform:['windows'],baseLinks:[{id:maintainedLink.id,version:maintainedLink.version}],links:[{id:maintainedLink.id,storage:'touchgal',content:maintainedLink.content,hash:'',code:'',password:'',size:'1 GB'}]}
  const deniedEdit=await api(authorCookie,'/api/patch/resource','PUT',edit)
  assert.equal(deniedEdit.status,403,JSON.stringify(deniedEdit.data))
  const deniedHealth=await api(authorCookie,'/api/patch/resource/link/health','POST',{patchId:patch,resourceId:id,linkId:maintainedLink.id,linkVersion:maintainedLink.version,evidenceRound:maintainedLink.evidence_round,health:maintainedLink.health,healthChangedAt:maintainedLink.health_changed_at ? dateIso(maintainedLink.health_changed_at) : null,action:'confirm_broken'})
  assert.equal(deniedHealth.status,403,JSON.stringify(deniedHealth.data))
  const messageCount=async()=>(await query('SELECT COUNT(*)::int AS n FROM user_message WHERE recipient_id=$1',[publisher])).rows[0].n
  const notificationsBefore=await messageCount()
  assert.equal((await api(adminCookie,'/api/patch/resource','PUT',edit)).status,200)
  await query('UPDATE public."user" SET moemoepoint=100 WHERE id=$1',[reader])
  const help=await api(readerCookie,'/api/help/post','POST',{requestId:randomUUID(),category:'download',title:'Synthetic handed-over resource help',content:'Synthetic download and extraction question for acceptance only.',patchId:patch,resourceId:id})
  assert.equal(typeof help.data.postId,'number',JSON.stringify(help.data))
  assert.equal((await api(followerCookie,'/api/patch/resource/download/access','POST',{patchId:patch,resourceId:id,linkId:maintainedLink.id})).status,200)
  const reported=await api(followerCookie,'/api/patch/resource/link/report','POST',{patchId:patch,resourceId:id,linkId:maintainedLink.id,linkVersion:maintainedLink.version,reason:'deleted'})
  assert.equal(reported.status,200,JSON.stringify(reported.data))
  assert.equal(await messageCount(),notificationsBefore,'help, admin edit and invalid-link report must not notify former publisher')
  const waitingRevision=(await query('SELECT revision FROM ops_case WHERE id=$1',[waiting])).rows[0].revision
  assert(int(waitingRevision)>1)
  const staleWaiting=await query("UPDATE ops_case SET status='resolved' WHERE id=$1 AND status='waiting_reporter' AND revision=1",[waiting])
  assert.equal(staleWaiting.rowCount,0,'handover invalidates old internal revision without changing waiting_reporter turn')
  const reopened = await api(readerCookie,`/api/case/${closed}/reopen`,'POST',{content:'Synthetic reporter reopens after publisher handover'})
  assert.equal(reopened.status,200)
  assert.equal((await query('SELECT owner_type FROM ops_case WHERE id=$1',[closed])).rows[0].owner_type,'staff')
  await api(readerCookie,'/api/patch/resource/like','PUT',{resourceId:id})
  assert.equal((await query('SELECT moemoepoint FROM public."user" WHERE id=$1',[publisher])).rows[0].moemoepoint,Number(before)-1)
  await api(followerCookie,'/api/patch/resource/like','PUT',{resourceId:id})
  assert.equal((await query('SELECT moemoepoint FROM public."user" WHERE id=$1',[publisher])).rows[0].moemoepoint,Number(before))
  await link(id,'user',new Date())
  const queue = await api(adminCookie,`/api/admin/backup?tab=unbacked&search=${run}&limit=100`)
  assert(!queue.data.items.some((item:{resourceId:number})=>item.resourceId===id))
  // Concurrent creation and handover serialize on the real resource lock.
  const concurrent = await resource('case-race'); await link(concurrent); await link(concurrent,'touchgal',when(5))
  const [created, transfer] = await Promise.all([
    api(readerCookie,'/api/case','POST',{ kind:'resource_mismatch',targetType:'resource',targetId:concurrent,expectedPatchId:patch,content:'Synthetic mismatching content requires a publisher handover race acceptance check.' }),
    handover(concurrent)
  ])
  assert.equal(transfer.status,200)
  assert.equal(typeof created.data,'object',JSON.stringify(created.data))
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM ops_case WHERE target_type='resource' AND target_id=$1 AND owner_type='publisher'",[concurrent])).rows[0].n,0)
  const cleanup = await handover(id,adminCookie,'delete')
  assert.equal(cleanup.status,200)
  assert.equal((await query('SELECT moemoepoint FROM public."user" WHERE id=$1',[publisher])).rows[0].moemoepoint,Number(before))
  assert((await query("SELECT content FROM admin_log WHERE type='delete' AND content LIKE $1",['%#'+id+'%'])).rows.some(row=>String(row.content).includes('保留原发布奖励')))
  assert(int((await query('SELECT COUNT(*)::int AS n FROM user_moemoepoint_ledger WHERE user_id=$1',[publisher])).rows[0].n) >= int(ledgerBefore))
  pass('E06-01 real handover, denied edits/link management, no help/admin/link-report notifications, stale waiting revision, cases, reopen, rewards and race')
}

async function downloadFlows() {
  const id=await resource('downloads'); const l1=await link(id); const l2=await link(id)
  await query('UPDATE patch_resource SET download=11 WHERE id=$1',[id])
  await query('UPDATE patch SET download=73 WHERE id=$1',[patch])
  await query('UPDATE patch_resource_link SET download=4 WHERE id=ANY($1::int[])',[[l1,l2]])
  const input={patchId:patch,resourceId:id,linkId:l1}
  const access=(cookie:string, linkId=l1)=>api(cookie,'/api/patch/resource/download/access','POST',{...input,linkId})
  const before=await getCount(id,l1)
  const first=await access(readerCookie)
  assert.equal(first.status,200); assert.equal(first.data.access.kind,'resource_granted')
  const expiry=first.data.access.obtainedExpiresAt
  assert(Math.abs(Date.parse(expiry)-Date.now()-86400000)<15000)
  const counters=await getCount(id,l1)
  assert.equal(counters.link,5);assert.equal(counters.resource,12);assert.equal(counters.patch,74)
  assert.equal(dateIso(counters.resource_updated),dateIso(before.resource_updated))
  assert.equal(dateIso(counters.link_updated),dateIso(before.link_updated))
  const second=await access(readerCookie,l2)
  assert.equal(second.data.access.kind,'link_revealed'); assert.equal(second.data.access.obtainedExpiresAt,expiry)
  const reused=await access(readerCookie)
  assert.equal(reused.data.access.kind,'reused');assert.equal(reused.data.access.obtainedExpiresAt,expiry)
  const restored=await api(readerCookie,'/api/patch/resource/download/access/restore','POST',{patchId:patch,resourceId:id,linkIds:[l1,l2]})
  assert.equal(restored.data.links.length,2)
  assert.deepEqual(await getCount(id,l1),counters)
  await api(adminCookie,`/api/admin/backup/detail?resourceId=${id}`)
  assert.deepEqual(await getCount(id,l1),counters)
  const click=await api(readerCookie,'/api/patch/resource/download','PUT',input)
  assert.equal(click.status,200)
  const afterClick=await getCount(id,l1)
  assert.equal(afterClick.link,counters.link);assert.equal(afterClick.resource,counters.resource);assert.equal(afterClick.patch,counters.patch)
  assert.equal(afterClick.click,int(counters.click)+1)
  // A new address version reveals again inside the fixed resource grant, without a new resource count.
  await query('UPDATE patch_resource_link SET content=content || $2,version=version+1,content_changed_at=CURRENT_TIMESTAMP WHERE id=$1',[l1,'/new-version'])
  const oldRestore=await api(readerCookie,'/api/patch/resource/download/access/restore','POST',{patchId:patch,resourceId:id,linkIds:[l1]})
  assert.equal(oldRestore.data.links.length,0)
  const newVersion=await access(readerCookie)
  assert.equal(newVersion.data.access.kind,'link_revealed')
  assert.equal(newVersion.data.access.obtainedExpiresAt,expiry)
  assert.equal((await getCount(id,l1)).link,counters.link+1)
  assert.equal((await getCount(id,l1)).resource,counters.resource)
  const added=await link(id)
  const addedResult=await access(readerCookie,added)
  assert.equal(addedResult.data.access.kind,'link_revealed')
  assert.equal(addedResult.data.access.obtainedExpiresAt,expiry)
  assert.equal((await getCount(id,added)).link,1)
  assert.equal((await getCount(id,added)).resource,counters.resource)
  // Competing first requests commit exactly one authorization and one resource count.
  const race=await resource('download-race');const raceLink=await link(race)
  const concurrent=await Promise.all(Array.from({length:4},()=>api(followerCookie,'/api/patch/resource/download/access','POST',{patchId:patch,resourceId:race,linkId:raceLink})))
  assert(concurrent.every(result=>result.status===200 || result.status===503))
  assert.equal(concurrent.filter(result=>result.data.access?.kind==='resource_granted').length,1)
  assert.equal((await getCount(race,raceLink)).resource,1)
  assert.equal((await getCount(race,raceLink)).link,1)
  // Visitor quota is represented by real persisted resource events, and a refusal writes no counters.
  const visitor='kun-resource-access-token='+randomUUID()
  const visitorResources:number[]=[]
  for(let index=0;index<6;index++){
    const rid=await resource('visitor'+index);const lid=await link(rid);visitorResources.push(rid)
    const result=await api(visitor,'/api/patch/resource/download/access','POST',{patchId:patch,resourceId:rid,linkId:lid})
    if(index<5){assert.equal(result.status,200);assert.equal(result.data.access.kind,'resource_granted')}
    else{assert.equal(result.status,429);assert.equal((await getCount(rid,lid)).resource,0);assert.equal((await getCount(rid,lid)).link,0)}
  }
  pass('E06-04 real four count branches, fixed 24h, restore/admin no count, old values, click-only counter, address version, concurrent retry and visitor refusal')
}

async function mergedExpiryFlows() {
  const survivor=await resource('expiry-user'); const staff=await resource('expiry-staff',admin)
  const left=await link(survivor); const right=await link(staff,'touchgal')
  const visitorToken=randomUUID(); const cookie='kun-resource-access-token='+visitorToken
  const access=(rid:number,lid:number)=>api(cookie,'/api/patch/resource/download/access','POST',{patchId:patch,resourceId:rid,linkId:lid})
  assert.equal((await access(survivor,left)).data.access.kind,'resource_granted')
  assert.equal((await access(staff,right)).data.access.kind,'resource_granted')
  const early=new Date(Date.now()+5*60000).toISOString()
  const late=new Date(Date.now()+25*60000).toISOString()
  for(const [rid,expiry] of [[survivor,early],[staff,late]] as const){
    await query('UPDATE patch_resource_access_grant SET expires=$2::timestamp WHERE resource_id=$1',[rid,expiry])
    await query('UPDATE patch_resource_access SET expires=$2::timestamp WHERE resource_id=$1 AND visitor_token=$3',[rid,expiry,visitorToken])
  }
  const quotaBefore=(await query("SELECT COUNT(*)::int AS n FROM patch_resource_access WHERE visitor_token=$1 AND access_kind='quota'",[visitorToken])).rows[0].n
  const preview=await api(adminCookie,`/api/admin/resource-merges/preview?userResourceId=${survivor}&staffResourceId=${staff}`)
  assert.equal(preview.data.canMerge,true,JSON.stringify(preview.data.blocks))
  const mergeInput={userResourceId:survivor,staffResourceId:staff,basis:preview.data.basis,contentConfirmed:true}
  const merges=await Promise.all([api(adminCookie,'/api/admin/resource-merges/merge','POST',mergeInput),api(adminCookie,'/api/admin/resource-merges/merge','POST',mergeInput)])
  assert(merges.every(result=>result.status===200 && result.data.userResourceId===survivor),JSON.stringify(merges.map(result=>result.data)))
  assert.equal(merges.filter(result=>result.data.alreadyMerged===false).length,1)
  assert.equal(merges.filter(result=>result.data.alreadyMerged===true).length,1)
  const before=await getCount(survivor,left)
  const restored=await api(cookie,'/api/patch/resource/download/access/restore','POST',{patchId:patch,resourceId:survivor,linkIds:[left,right]})
  assert.equal(restored.data.obtainedExpiresAt,late)
  assert.equal(restored.data.links.find((row:{id:number})=>row.id===left).revealedExpiresAt,early)
  assert.equal(restored.data.links.find((row:{id:number})=>row.id===right).revealedExpiresAt,late)
  assert.equal(restored.data.links.length,2)
  assert.deepEqual(await getCount(survivor,left),before)
  await query("UPDATE patch_resource_access SET expires=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE resource_id=$1 AND link_id=$2 AND visitor_token=$3",[survivor,left,visitorToken])
  const partial=await api(cookie,'/api/patch/resource/download/access/restore','POST',{patchId:patch,resourceId:survivor,linkIds:[left,right]})
  assert.deepEqual(partial.data.links.map((row:{id:number})=>row.id),[right])
  assert.equal(partial.data.obtainedExpiresAt,late)
  assert.equal((await access(survivor,left)).data.access.kind,'link_revealed')
  assert.equal((await getCount(survivor,left)).resource,before.resource)
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM patch_resource_access WHERE visitor_token=$1 AND access_kind='quota'",[visitorToken])).rows[0].n,quotaBefore)
  await query('UPDATE patch_resource_link SET version=version+1 WHERE id=$1',[right])
  const stale=await api(cookie,'/api/patch/resource/download/access/restore','POST',{patchId:patch,resourceId:survivor,linkIds:[right]})
  assert.equal(stale.data.links.length,0)
  const resolve=await api('',`/api/patch/resource/resolve?resourceId=${staff}`)
  assert.equal(resolve.data.resourceId,survivor);assert(resolve.headers.get('cache-control')?.includes('no-store'))
  await query('UPDATE patch_resource SET status=1 WHERE id=$1',[survivor])
  assert.equal((await api('',`/api/patch/resource/resolve?resourceId=${staff}`)).data,null)
  await query('UPDATE patch_resource SET status=0 WHERE id=$1',[survivor])
  assert.equal((await api(adminCookie,'/api/admin/resource-merges/reopen','POST',{userResourceId:survivor,staffResourceId:staff})).data,'这一对已经合并')
  assert.equal((await query("SELECT status FROM patch_resource_merge_record WHERE user_resource_id=$1 AND staff_resource_id=$2",[survivor,staff])).rows[0].status,'merged')
  const unmapped=await resource('deleted-without-merge');await query('DELETE FROM patch_resource WHERE id=$1',[unmapped])
  assert.equal((await api('',`/api/patch/resource/resolve?resourceId=${unmapped}`)).data,null)
  pass('E06-03 simultaneous same-pair merge commits once; merged grants preserve per-link earlier/later expiry, restore without counts, expired/old versions stay hidden, visitor quotas retained, private old-ID lookup')
}

async function atomicRollbackFlows(){
  const handing=await resource('rollback-handover');await link(handing);await link(handing,'touchgal')
  const key=`patch/${patch}/resource/${'ef'.repeat(32)}/rollback.zip`;await link(handing,'s3',when(7),key)
  const issue=await caseRow(handing,'waiting_reporter')
  const survivor=await resource('rollback-user'),staff=await resource('rollback-staff',admin)
  await link(survivor);const staffLink=await link(staff,'touchgal')
  const mergeBefore=await query('SELECT id,note,download FROM patch_resource WHERE id=ANY($1::int[]) ORDER BY id',[[survivor,staff]])
  const patchBefore=(await query('SELECT download,resource_count,resource_update_time FROM patch WHERE id=$1',[patch])).rows[0]
  const ledgerBefore=(await query('SELECT COUNT(*)::int AS n FROM user_moemoepoint_ledger WHERE user_id=ANY($1::int[])',[[publisher,admin]])).rows[0].n
  const functionName=`om06_${run}_reject_log`
  const triggerName=`om06_${run}_reject_log_trigger`
  await query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF (NEW.type='resource_handover' AND NEW.content LIKE '资源 ${handing} 已交由站方维护%') OR
       (NEW.type='resource_merge' AND NEW.content LIKE '%合并了资源 ${survivor} 与站方资源 ${staff}。%')
    THEN RAISE EXCEPTION 'controlled module06 final-write fault'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER ${triggerName} BEFORE INSERT ON admin_log FOR EACH ROW EXECUTE FUNCTION ${functionName}()`)
  try{
    const failed=await fetch(origin+`/api/patch/resource?resourceId=${handing}&action=handover`,{method:'DELETE',headers:{Cookie:authorCookie,Origin:origin,'x-requested-with':'kun-fetch'}})
    assert.equal(failed.status,500);await failed.arrayBuffer()
    assert.equal((await query('SELECT publisher_left_at FROM patch_resource WHERE id=$1',[handing])).rows[0].publisher_left_at,null)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM patch_resource_link WHERE resource_id=$1',[handing])).rows[0].n,3)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM patch_resource_file_cleanup WHERE object_key=$1',[key])).rows[0].n,0)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM patch_resource_link_history WHERE resource_id=$1',[handing])).rows[0].n,0)
    assert.deepEqual((await query('SELECT owner_type,status,revision FROM ops_case WHERE id=$1',[issue])).rows[0],{owner_type:'publisher',status:'waiting_reporter',revision:1})
    const preview=await api(adminCookie,`/api/admin/resource-merges/preview?userResourceId=${survivor}&staffResourceId=${staff}`)
    assert.equal(preview.data.canMerge,true)
    const failedMerge=await fetch(origin+'/api/admin/resource-merges/merge',{method:'POST',headers:{Cookie:adminCookie,Origin:origin,'x-requested-with':'kun-fetch','content-type':'application/json'},body:JSON.stringify({userResourceId:survivor,staffResourceId:staff,basis:preview.data.basis,contentConfirmed:true})})
    assert.equal(failedMerge.status,500);await failedMerge.arrayBuffer()
    assert.deepEqual((await query('SELECT id,note,download FROM patch_resource WHERE id=ANY($1::int[]) ORDER BY id',[[survivor,staff]])).rows,mergeBefore.rows)
    assert.equal((await query('SELECT resource_id FROM patch_resource_link WHERE id=$1',[staffLink])).rows[0].resource_id,staff)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM patch_resource_merge_record WHERE user_resource_id=$1 AND staff_resource_id=$2',[survivor,staff])).rows[0].n,0)
    assert.deepEqual((await query('SELECT download,resource_count,resource_update_time FROM patch WHERE id=$1',[patch])).rows[0],patchBefore)
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM user_moemoepoint_ledger WHERE user_id=ANY($1::int[])',[[publisher,admin]])).rows[0].n,ledgerBefore)
  }finally{await query(`DROP TRIGGER ${triggerName} ON admin_log; DROP FUNCTION ${functionName}()`)}
  assert.equal((await handover(handing)).data.action,'handed_over')
  const current=await api(adminCookie,`/api/admin/resource-merges/preview?userResourceId=${survivor}&staffResourceId=${staff}`)
  assert.equal((await api(adminCookie,'/api/admin/resource-merges/merge','POST',{userResourceId:survivor,staffResourceId:staff,basis:current.data.basis,contentConfirmed:true})).data.userResourceId,survivor)
  pass('E06-01/03 real PostgreSQL fault at final audit insert rolls back handover queue/history/cases and merge links/cards/mapping/counters/ledger; retry commits')
}

async function storageRecoveryFlows(){
  const id=await resource('storage-fail');await link(id);await link(id,'touchgal',when(5))
  const key=`patch/${patch}/resource/${'ab'.repeat(32)}/acceptance.zip`
  await link(id,'s3',when(7),key)
  const shared=await resource('storage-reference');await link(shared,'s3',when(7),key)
  const sharedResult=await handover(id)
  assert.equal(sharedResult.data.action,'handed_over')
  const canceled=(await query('SELECT status FROM patch_resource_file_cleanup WHERE object_key=$1',[key])).rows[0]
  assert.equal(canceled.status,'cancelled')
  const failedId=await resource('storage-replay');await link(failedId);await link(failedId,'touchgal',when(5))
  const failedKey=`patch/${patch}/resource/${'cd'.repeat(32)}/acceptance-replay.zip`
  await link(failedId,'s3',when(7),failedKey)
  await fetch('http://127.0.0.1:36741/control/fail-deletes?enabled=true',{method:'POST'})
  const failed=await handover(failedId)
  assert.equal(failed.status,200);assert.equal(failed.data.action,'handed_over')
  const job=(await query('SELECT id,status,failure_category FROM patch_resource_file_cleanup WHERE object_key=$1',[failedKey])).rows[0]
  assert.equal(job.status,'failed');assert.equal(job.failure_category,'delete_failed')
  const logsBefore=(await query("SELECT COUNT(*)::int AS n FROM admin_log WHERE type='resource_handover' AND content LIKE $1",['资源 '+failedId+' 已交由站方维护%'])).rows[0].n
  await fetch('http://127.0.0.1:36741/control/fail-deletes?enabled=false',{method:'POST'})
  const replay=spawnSync('pnpm',['exec','esno','scripts/replayResourceFileCleanup.ts','--confirm-database','official_mirror_e_ui_e2e','--ids',String(job.id)],{
    env:{...process.env,KUN_DATABASE_URL:database.href},encoding:'utf8'
  })
  await writeFile(join(artifacts,'cleanup-replay.log'),replay.stdout+replay.stderr)
  assert.equal(replay.status,0,replay.stderr)
  assert.equal((await query('SELECT status FROM patch_resource_file_cleanup WHERE id=$1',[job.id])).rows[0].status,'completed')
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM admin_log WHERE type='resource_handover' AND content LIKE $1",['资源 '+failedId+' 已交由站方维护%'])).rows[0].n,logsBefore)
  pass('E06-01 real controlled S3 shared-reference protection, postcommit delete failure, durable replay in fresh process without repeated handover')
  const restartId=await resource('restart-replay');await link(restartId);await link(restartId,'touchgal')
  const restartKey=`patch/${patch}/resource/${'da'.repeat(32)}/restart.zip`;await link(restartId,'s3',when(7),restartKey)
  await fetch('http://127.0.0.1:36741/control/fail-deletes?enabled=true',{method:'POST'})
  try {
    assert.equal((await handover(restartId)).data.action,'handed_over')
    const restartJob=(await query('SELECT id,status FROM patch_resource_file_cleanup WHERE object_key=$1',[restartKey])).rows[0]
    assert.equal(restartJob.status,'failed')
    await writeFile(join(artifacts,'pending-restart.json'),JSON.stringify({marker:required('KUN_ACCEPTANCE_MARKER'),sourceSha:required('KUN_E2E_SOURCE_SHA'),resourceId:restartId,jobId:restartJob.id},null,2))
  } finally { await fetch('http://127.0.0.1:36741/control/fail-deletes?enabled=false',{method:'POST'}) }
}

async function main(){
  await mkdir(artifacts,{recursive:true})
  const identity=(await query('SELECT current_database() AS db,current_user AS role')).rows[0]
  assert.equal(identity.db,'official_mirror_e_ui_e2e');assert.equal(identity.role,'official_mirror_e')
  admin=int((await query('SELECT id FROM public."user" WHERE name=\'e2e_admin\'')).rows[0].id)
  publisher=await user('publisher',2);reader=await user('reader');follower=await user('follower')
  patch=int((await query(`INSERT INTO patch(unique_id,name,user_id,content_limit,type,language,engine,platform,updated)
VALUES($1,$2,$3,'sfw',ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],CURRENT_TIMESTAMP) RETURNING id`,[randomBytes(4).toString('hex'),run,publisher])).rows[0].id)
  authorCookie=auth(await session(redis,publisher,run+'publisher',2));readerCookie=auth(await session(redis,reader,run+'reader',1))
  followerCookie=auth(await session(redis,follower,run+'follower',1));adminCookie=auth(await session(redis,admin,'e2e_admin',4))
  try{
    await queueFlows(); await handoverFlows(); await downloadFlows(); await mergedExpiryFlows(); await atomicRollbackFlows(); await storageRecoveryFlows()
    await writeFile(join(artifacts,'http-results.json'),JSON.stringify({sourceSha:required('KUN_E2E_SOURCE_SHA'),run,checks,passed:true},null,2))
  }catch(error){
    await writeFile(join(artifacts,'http-results.json'),JSON.stringify({sourceSha:required('KUN_E2E_SOURCE_SHA'),run,checks,passed:false,error:String(error)},null,2));throw error
  }
}
void main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await redis.quit();await pool.end()})

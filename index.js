const fs = require('fs/promises')
const path = require('path')
const argv = require('minimist')(process.argv.slice(2))

const env = require('./env.json')
const oldList = require('./list.json')
const unfollowersDict = require('./unfollowers.json')
const userStore = require('./userStore.json')

const Twit = require('twit')
const T = new Twit({
    consumer_key: env.key,
    consumer_secret: env.secret,
    access_token: env.token,
    access_token_secret: env.token_secret
})

const writeToJson = (data, filename) => {
    return fs.writeFile(path.join('.', filename), JSON.stringify(data))
}

const updateFollowList = async username => {
    const result = await T.get('followers/ids', { screen_name: username, stringify_ids: true })
    const newIds = result.data.ids
    console.log(`Fetched ${newIds.length} IDs`)
    if (newIds.length === oldList.length) {
        console.log(`Follower count no change: ${newIds.length}`)
    } else {
        console.log(`Follower count ${newIds.length > oldList.length ? 'increased' : 'dropped'} by ${Math.abs(oldList.length - newIds.length)}`)
    }

    const absentIds = oldList.filter(uid => !newIds.includes(uid))
    console.log(`${absentIds.length} unfollowed based off previous list`)

    const newFollowersIds = newIds.filter(uid => !oldList.includes(uid))
    console.log(`${newFollowersIds.length} new followers`)

    // const lookupResult = await T.post('users/lookup', { user_id: absentIds.join(',') })
    await writeToJson(newIds, 'list.json')
    for (const id of absentIds) {
        unfollowersDict[id] = (unfollowersDict[id] || []).concat(+Date.now())
    }
    await writeToJson(unfollowersDict, 'unfollowers.json')
}

const getUserInfo = async (username) => {
    const lookupResult = await T.post('users/lookup', { screen_name: username, stringify_ids: true })
    console.log(lookupResult.data[0])
}

const getUserInfoFromId = async (userId, isManual) => {
    if (userId.length === 0) {
        console.log('List of user IDs is empty.')
        return
    }
    if (isManual) {
        const ids = userId.split(',')
        const reqIds = ids.length === 1 ? userId : ids[0]
        try {
            const lookupResult = await T.get('users/show', { user_id: reqIds, stringify_ids: true })
            const res = lookupResult.data[0]
            console.log(`${res.name} (@${res.screen_name}) [${res.id}]`)
        } catch (err) {
            if (err.statusCode === 404) {
                console.log(`ID [${reqIds}] not found on Twitter. Possibly incorrect ID, or user suspended/deleted.`)
            }
        } finally {
            if (ids.length > 1) {
                return getUserInfoFromId(ids.slice(1, ids.length).join(','), isManual)
            }
        }
    } else {
        try {
            const lookupResult = await T.post('users/lookup', { user_id: userId, stringify_ids: true })
            lookupResult.data.forEach((res, idx) => {
                console.log(`User #${idx}: ${res.name} (@${res.screen_name}) [${res.id}]`)
            })
            const difference = userId.split(',').length - lookupResult.data.length
            if (difference !== 0) {
                console.log(`${difference} missing accounts from lookup. Possibly incorrect ID, or user suspended/deleted.`)
                console.log('Pulling from local DB store.')

                const missingList = userId.split(',').filter(id => !lookupResult.data.some(resData => resData.id_str === id))
                missingList.forEach(uid => {
                    const userInfo = userStore[uid]
                    if (typeof userInfo === 'undefined') {
                        console.log(`ID [${uid}] could not be found in local store.`)
                        getUserInfoFromId(uid, true)
                    } else {
                        console.log(`${userInfo.n} (@${userInfo.h}) [${uid}]`)
                    }
                })
                // Fetch from DB
            }
        } catch (err) {
            if (err.statusCode === 404) {
                console.error('There was a non-match for user ID. Switching to manual mode.')
                await getUserInfoFromId(userId, true)
            } else {
                console.error(err)
            }
        }
    }
}

const storeFollowers = async (userIdsList) => {
    const maxReqs = 100
    const storedIds = Object.keys(userStore)
    const reqUsers = userIdsList.filter(id => !storedIds.includes(id)).slice(0, maxReqs)
    if (reqUsers.length === 0) {
        console.log('All current followers have been stored. Use --force to force an update.')
        return
    }
    try {
        const lookupResult = await T.post('users/lookup', { user_id: reqUsers.join(','), stringify_ids: true })
        console.log(`Found ${lookupResult.data.length} new entries`)
        lookupResult.data.forEach(result => {
            userStore[result.id_str] = { n: result.name, h: result.screen_name, d: result.description, f: result.followers_count, c: new Date(result.created_at).getTime() }
        })
        await writeToJson(userStore, 'userStore.json')
    } catch (err) {
        console.error(err)
    }
}

if (argv.recent === true || typeof argv.recent === 'number') {
    const toPoll = typeof argv.recent === 'number' ? argv.recent : 10
    const userIds = Object.keys(unfollowersDict).sort((a, b) => unfollowersDict[b].pop() - unfollowersDict[a].pop()).slice(0, toPoll)
    getUserInfoFromId(userIds.join(','))
} else if (typeof argv.n === 'string') {
    getUserInfo(argv.n).catch(console.error)
} else if (typeof argv.id === 'number') {
    getUserInfoFromId(argv.id).catch(console.error)
} else if (argv.store === true) {
    storeFollowers(oldList).catch(console.error)
    // TODO: Pull from old list, or force pull from Twitter
} else if (argv['store-count'] === true) {
    console.log(`There are ${Object.keys(userStore).length} users stored.`)
} else if (argv.update === true) {
    updateFollowList(env.username).catch(console.error)
} else {
    console.log([
        'Workflow:',
        'Update -> Store -> Recent'
    ].join('\n'))
}
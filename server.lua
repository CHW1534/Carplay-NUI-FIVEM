local vehicleState = {}
local parties = {}
local playerParty = {}
local pendingInvites = {}
local partySeq = 0

local PARTY_MAX = 8
local INVITE_RANGE = 40.0
local INVITE_SECONDS = 45
local CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

local function partyTell(src, ok, message)
    TriggerClientEvent('carplay:client:partyResult', src, {
        ok = ok,
        message = message
    })
end

local function playerName(src)
    return GetPlayerName(src) or ('ID ' .. tostring(src))
end

local function makeCode()
    for _attempt = 1, 20 do
        local code = ''
        for _n = 1, 4 do
            local index = math.random(1, #CODE_CHARS)
            code = code .. CODE_CHARS:sub(index, index)
        end
        local taken = false
        for _, party in pairs(parties) do
            if party.code == code then
                taken = true
                break
            end
        end
        if not taken then
            return code
        end
    end
    return 'P' .. tostring(os.time() % 1000)
end

local function memberList(party)
    local members = {}
    for src, info in pairs(party.members) do
        members[#members + 1] = {
            id = src,
            name = info.name,
            host = src == party.host
        }
    end
    table.sort(members, function(a, b)
        if a.host ~= b.host then return a.host end
        return a.id < b.id
    end)
    return members
end

local function pushPartyState(partyId)
    local party = parties[partyId]
    if not party then return end
    local members = memberList(party)
    local hostInfo = party.members[party.host]
    for src, _ in pairs(party.members) do
        TriggerClientEvent('carplay:client:partyState', src, {
            id = partyId,
            code = party.code,
            host = party.host,
            hostName = hostInfo and hostInfo.name or 'Anfitrión',
            isHost = src == party.host,
            members = members
        })
    end
end

local function pushPartyTrack(party, exceptSrc)
    for src, _ in pairs(party.members) do
        if src ~= exceptSrc then
            TriggerClientEvent('carplay:client:partyTrack', src, party.track)
        end
    end
end

local function clearPlayerParty(src)
    playerParty[src] = nil
    pendingInvites[src] = nil
    TriggerClientEvent('carplay:client:partyState', src, nil)
    TriggerClientEvent('carplay:client:partyTrack', src, nil)
    TriggerClientEvent('carplay:client:partyInviteClear', src)
end

local function leaveParty(src, quiet)
    local partyId = playerParty[src]
    if not partyId then return end
    local party = parties[partyId]
    playerParty[src] = nil
    pendingInvites[src] = nil
    if not quiet then
        TriggerClientEvent('carplay:client:partyState', src, nil)
        TriggerClientEvent('carplay:client:partyTrack', src, nil)
    end
    if not party then return end

    local name = party.members[src] and party.members[src].name or playerName(src)
    party.members[src] = nil

    if party.host == src or next(party.members) == nil then
        for member, _ in pairs(party.members) do
            playerParty[member] = nil
            TriggerClientEvent('carplay:client:partyState', member, nil)
            TriggerClientEvent('carplay:client:partyTrack', member, nil)
            partyTell(member, false, 'La party se cerró.')
        end
        parties[partyId] = nil
        return
    end

    pushPartyState(partyId)
    for member, _ in pairs(party.members) do
        partyTell(member, true, name .. ' salió de la party.')
    end
end

local function syncPartyFromHost(src, track)
    local partyId = playerParty[src]
    if not partyId then return end
    local party = parties[partyId]
    if not party or party.host ~= src then return end
    party.track = track
    pushPartyTrack(party, src)
end

local function addMember(partyId, src)
    local party = parties[partyId]
    if not party then return false, 'Esa party ya no existe.' end
    if playerParty[src] then return false, 'Ya estás en una party. Sal primero.' end
    local count = 0
    for _ in pairs(party.members) do count = count + 1 end
    if count >= PARTY_MAX then return false, 'La party está llena.' end

    party.members[src] = { name = playerName(src) }
    playerParty[src] = partyId
    pendingInvites[src] = nil
    TriggerClientEvent('carplay:client:partyInviteClear', src)
    pushPartyState(partyId)
    TriggerClientEvent('carplay:client:partyTrack', src, party.track)
    TriggerClientEvent('carplay:client:partyQueue', src, {
        queue = party.queue or {},
        index = party.index or -1
    })
    partyTell(src, true, 'Entraste a la party ' .. party.code .. '.')
    if party.host ~= src then
        partyTell(party.host, true, playerName(src) .. ' se unió a la party.')
    end
    return true
end

RegisterNetEvent('carplay:server:syncVehicle', function(netId, data)
    if not netId or netId == 0 then return end

    if data == nil or not data.isPlaying then
        -- Stop or clear: keep data but mark not playing
        if data == nil then
            vehicleState[netId] = nil
        else
            vehicleState[netId] = data
            vehicleState[netId].serverTime = nil
            vehicleState[netId].startPosition = nil
        end
    else
        local existing = vehicleState[netId]
        local now = os.time()

        -- New track or resumed playback: record server timestamp and position
        if not existing or existing.id ~= data.id or not existing.isPlaying then
            data.serverTime = now
            data.startPosition = data.position or 0
        else
            -- Same track, still playing: preserve original start reference
            data.serverTime = existing.serverTime or now
            data.startPosition = existing.startPosition or (data.position or 0)
        end

        vehicleState[netId] = data
    end

    TriggerClientEvent('carplay:client:syncVehicle', -1, netId, vehicleState[netId])
    syncPartyFromHost(source, vehicleState[netId])
end)

RegisterNetEvent('carplay:server:requestSync', function()
    local src = source
    TriggerClientEvent('carplay:client:initSync', src, vehicleState)
end)

-- Provide server time to clients for accurate sync
RegisterNetEvent('carplay:server:getTime', function()
    local src = source
    TriggerClientEvent('carplay:client:serverTime', src, os.time())
end)

RegisterNetEvent('carplay:server:partyCreate', function()
    local src = source
    if playerParty[src] then
        partyTell(src, false, 'Ya estás en una party.')
        return
    end

    partySeq = partySeq + 1
    local partyId = partySeq
    parties[partyId] = {
        host = src,
        code = makeCode(),
        members = {
            [src] = { name = playerName(src) }
        },
        track = nil,
        queue = {},
        index = -1
    }
    playerParty[src] = partyId
    pushPartyState(partyId)
    partyTell(src, true, 'Party creada. Comparte el código o invita por ID.')
end)

RegisterNetEvent('carplay:server:partyJoin', function(code)
    local src = source
    code = type(code) == 'string' and code:upper():gsub('%s+', '') or ''
    if #code ~= 4 then
        partyTell(src, false, 'El código tiene 4 letras.')
        return
    end

    for partyId, party in pairs(parties) do
        if party.code == code then
            local ok, err = addMember(partyId, src)
            if not ok then partyTell(src, false, err) end
            return
        end
    end

    partyTell(src, false, 'No hay una party con ese código.')
end)

RegisterNetEvent('carplay:server:partyInvite', function(targetId)
    local src = source
    targetId = tonumber(targetId)
    local partyId = playerParty[src]
    local party = partyId and parties[partyId] or nil
    if not party or party.host ~= src then
        partyTell(src, false, 'Solo el anfitrión puede invitar.')
        return
    end
    if not targetId or targetId == src or not GetPlayerName(targetId) then
        partyTell(src, false, 'Ese jugador no está conectado.')
        return
    end
    if playerParty[targetId] then
        partyTell(src, false, 'Esa persona ya está en una party.')
        return
    end

    local count = 0
    for _ in pairs(party.members) do count = count + 1 end
    if count >= PARTY_MAX then
        partyTell(src, false, 'La party está llena (máximo ' .. PARTY_MAX .. ').')
        return
    end

    pendingInvites[targetId] = {
        partyId = partyId,
        host = src,
        hostName = playerName(src),
        expires = os.time() + INVITE_SECONDS
    }
    TriggerClientEvent('carplay:client:partyInvite', targetId, {
        hostName = playerName(src),
        code = party.code
    })
    partyTell(src, true, 'Invitación enviada a ' .. playerName(targetId) .. '.')
end)

RegisterNetEvent('carplay:server:partyRespond', function(accept)
    local src = source
    local invite = pendingInvites[src]
    if not invite then return end
    pendingInvites[src] = nil
    TriggerClientEvent('carplay:client:partyInviteClear', src)

    if invite.expires < os.time() or not parties[invite.partyId] then
        partyTell(src, false, 'La invitación ya venció.')
        return
    end

    if not accept then
        partyTell(src, true, 'Rechazaste la party.')
        if GetPlayerName(invite.host) then
            partyTell(invite.host, false, playerName(src) .. ' rechazó la invitación.')
        end
        return
    end

    local ok, err = addMember(invite.partyId, src)
    if not ok then partyTell(src, false, err) end
end)

RegisterNetEvent('carplay:server:partyLeave', function()
    local src = source
    if not playerParty[src] then
        partyTell(src, false, 'No estás en una party.')
        return
    end
    leaveParty(src, false)
    partyTell(src, true, 'Saliste de la party.')
end)

RegisterNetEvent('carplay:server:partyKick', function(targetId)
    local src = source
    targetId = tonumber(targetId)
    local partyId = playerParty[src]
    local party = partyId and parties[partyId] or nil
    if not party or party.host ~= src then
        partyTell(src, false, 'Solo el anfitrión puede sacar gente.')
        return
    end
    if not targetId or targetId == src or not party.members[targetId] then
        partyTell(src, false, 'Esa persona no está en tu party.')
        return
    end

    leaveParty(targetId, false)
    partyTell(targetId, false, 'Te sacaron de la party.')
end)

local function partyOf(src)
    local partyId = playerParty[src]
    if not partyId then return nil end
    return parties[partyId], partyId
end

local function cleanQueueItems(items, limit)
    local clean = {}
    limit = limit or 10
    if type(items) ~= 'table' then return clean end
    for _, item in ipairs(items) do
        if type(item) == 'table' and type(item.id) == 'string' and #item.id > 0 and #item.id <= 32 then
            clean[#clean + 1] = {
                id = item.id,
                url = type(item.url) == 'string' and item.url:sub(1, 180) or '',
                title = type(item.title) == 'string' and item.title:sub(1, 120) or 'Audio de YouTube',
                author = type(item.author) == 'string' and item.author:sub(1, 80) or ''
            }
        end
        if #clean >= limit then break end
    end
    return clean
end

RegisterNetEvent('carplay:server:partyQueueAdd', function(items)
    local src = source
    local party = partyOf(src)
    if not party or src == party.host then return end
    local clean = cleanQueueItems(items)
    if #clean == 0 then return end
    TriggerClientEvent('carplay:client:partyHostControl', party.host, {
        cmd = 'add',
        items = clean
    })
    partyTell(src, true, 'Canción enviada a la party.')
end)

RegisterNetEvent('carplay:server:partySkip', function(dir)
    local src = source
    local party = partyOf(src)
    if not party or src == party.host then return end
    TriggerClientEvent('carplay:client:partyHostControl', party.host, {
        cmd = tonumber(dir) == -1 and 'prev' or 'next'
    })
end)

RegisterNetEvent('carplay:server:partyPlayIndex', function(index)
    local src = source
    local party = partyOf(src)
    if not party or src == party.host then return end
    index = tonumber(index) or 0
    if index < 0 or index > 80 then return end
    TriggerClientEvent('carplay:client:partyHostControl', party.host, {
        cmd = 'play',
        index = index
    })
end)

RegisterNetEvent('carplay:server:partyQueueSync', function(payload)
    local src = source
    local party = partyOf(src)
    if not party or party.host ~= src or type(payload) ~= 'table' then return end
    local clean = cleanQueueItems(payload.queue, 40)
    if type(payload.queue) == 'table' and #clean == 0 and #payload.queue > 0 then return end
    party.queue = clean
    party.index = tonumber(payload.index) or -1
    for member, _ in pairs(party.members) do
        if member ~= src then
            TriggerClientEvent('carplay:client:partyQueue', member, {
                queue = party.queue,
                index = party.index
            })
        end
    end
end)

RegisterNetEvent('carplay:server:partyNearby', function()
    local src = source
    local partyId = playerParty[src]
    local party = partyId and parties[partyId] or nil
    if not party or party.host ~= src then return end

    local origin = GetEntityCoords(GetPlayerPed(src))
    local nearby = {}
    for _, id in ipairs(GetPlayers()) do
        local target = tonumber(id)
        if target and target ~= src and not playerParty[target] then
            local ped = GetPlayerPed(target)
            if ped and ped ~= 0 then
                local dist = #(origin - GetEntityCoords(ped))
                if dist <= INVITE_RANGE then
                    nearby[#nearby + 1] = {
                        id = target,
                        name = playerName(target),
                        dist = math.floor(dist + 0.5)
                    }
                end
            end
        end
    end
    table.sort(nearby, function(a, b) return a.dist < b.dist end)
    TriggerClientEvent('carplay:client:partyNearby', src, nearby)
end)

AddEventHandler('playerDropped', function()
    leaveParty(source, true)
end)

local searchCache = {}
local searchToken = {}
local SEARCH_CACHE_SEC = 120

local function urlEncode(str)
    str = tostring(str or '')
    return (str:gsub('([^%w%-_%.~])', function(c)
        return string.format('%%%02X', string.byte(c))
    end))
end

local function utf8char(n)
    if n < 128 then return string.char(n) end
    if n < 2048 then
        return string.char(192 + math.floor(n / 64), 128 + (n % 64))
    end
    if n < 65536 then
        return string.char(224 + math.floor(n / 4096), 128 + (math.floor(n / 64) % 64), 128 + (n % 64))
    end
    return '?'
end

local function unescapeJsonText(s)
    if type(s) ~= 'string' then return '' end
    s = s:gsub('\\u(%x%x%x%x)', function(hex)
        return utf8char(tonumber(hex, 16) or 32)
    end)
    s = s:gsub('\\/', '/')
    s = s:gsub('\\"', '"')
    s = s:gsub('\\\\', '\\')
    return s
end

local function trackFromVideo(id, title, author, duration)
    if type(id) ~= 'string' or #id < 6 or #id > 15 then return nil end
    return {
        id = id,
        url = 'https://www.youtube.com/watch?v=' .. id,
        title = type(title) == 'string' and title:sub(1, 140) or 'Canción',
        author = type(author) == 'string' and author:sub(1, 80) or 'Artista',
        duration = type(duration) == 'string' and duration:sub(1, 12) or ''
    }
end

local function walkYoutubeVideos(node, items, seen, depth)
    if type(node) ~= 'table' or #items >= 12 or (depth or 0) > 16 then return end
    local video = node.videoRenderer
    if type(video) == 'table' and type(video.videoId) == 'string' then
        local id = video.videoId
        if not seen[id] then
            seen[id] = true
            local title = ''
            if type(video.title) == 'table' then
                if type(video.title.runs) == 'table' and video.title.runs[1] then
                    title = video.title.runs[1].text or ''
                else
                    title = video.title.simpleText or ''
                end
            end
            local author = ''
            local owner = video.ownerText or video.longBylineText or video.shortBylineText
            if type(owner) == 'table' and type(owner.runs) == 'table' and owner.runs[1] then
                author = owner.runs[1].text or ''
            end
            local duration = ''
            if type(video.lengthText) == 'table' then
                duration = video.lengthText.simpleText or ''
            end
            local item = trackFromVideo(id, title, author, duration)
            if item then items[#items + 1] = item end
        end
        return
    end
    for _, value in pairs(node) do
        if type(value) == 'table' then
            walkYoutubeVideos(value, items, seen, (depth or 0) + 1)
        end
    end
end

local function parseInvidiousList(data)
    local items = {}
    local list = data
    if type(data) == 'table' and data.items then list = data.items end
    if type(list) ~= 'table' then return items end
    for _, v in ipairs(list) do
        if type(v) == 'table' then
            local id = v.videoId
            if (not id) and type(v.url) == 'string' then
                id = v.url:match('v=([%w_-]+)') or v.url:match('/watch/([%w_-]+)')
            end
            if (not v.type or v.type == 'video') and id then
                local duration = v.lengthSeconds
                if type(duration) == 'number' then
                    local m = math.floor(duration / 60)
                    local s = duration % 60
                    duration = ('%d:%02d'):format(m, s)
                elseif type(v.duration) == 'string' then
                    duration = v.duration
                elseif type(v.duration) == 'number' then
                    local m = math.floor(v.duration / 60)
                    duration = ('%d:%02d'):format(m, v.duration % 60)
                else
                    duration = ''
                end
                local item = trackFromVideo(id, v.title, v.author or v.uploaderName, duration)
                if item then items[#items + 1] = item end
            end
        end
        if #items >= 12 then break end
    end
    return items
end

local function parseYouTubeHtml(body)
    local items = {}
    local seen = {}
    if type(body) ~= 'string' then return items end
    local pos = 1
    while #items < 12 do
        local startAt, endAt, id = body:find('"videoRenderer":{"videoId":"([%w_-]+)"', pos)
        if not startAt then break end
        pos = endAt + 1
        if not seen[id] then
            seen[id] = true
            local chunk = body:sub(startAt, startAt + 2800)
            local title = chunk:match('"title":{"runs":%[{"text":"(.-)"}%]') or ''
            local author = chunk:match('"longBylineText":{"runs":%[{"text":"(.-)"')
                or chunk:match('"shortBylineText":{"runs":%[{"text":"(.-)"')
                or chunk:match('"ownerText":{"runs":%[{"text":"(.-)"')
                or ''
            local duration = chunk:match('"lengthText":{"simpleText":"(.-)"}') or ''
            local item = trackFromVideo(id, unescapeJsonText(title), unescapeJsonText(author), duration)
            if item then items[#items + 1] = item end
        end
    end
    return items
end

local function httpGet(url, cb)
    PerformHttpRequest(url, function(code, body)
        cb(tonumber(code) or 0, body)
    end, 'GET', '', {
        ['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ['Accept'] = 'application/json,text/html'
    })
end

RegisterNetEvent('carplay:server:searchSongs', function(query, reqId)
    local src = source
    query = tostring(query or ''):gsub('%c', ' '):gsub('^%s+', ''):gsub('%s+$', ''):sub(1, 80)
    reqId = tonumber(reqId) or 0
    if #query < 2 then
        TriggerClientEvent('carplay:client:searchResults', src, { items = {}, query = query, reqId = reqId })
        return
    end

    local cacheKey = query:lower()
    local cached = searchCache[cacheKey]
    if cached and (os.time() - cached.t) < SEARCH_CACHE_SEC then
        TriggerClientEvent('carplay:client:searchResults', src, { items = cached.items, query = query, reqId = reqId })
        return
    end

    local token = (searchToken[src] or 0) + 1
    searchToken[src] = token
    local done = false

    local function finish(items)
        if done or searchToken[src] ~= token then return end
        if type(items) ~= 'table' or #items == 0 then return end
        done = true
        searchCache[cacheKey] = { t = os.time(), items = items }
        TriggerClientEvent('carplay:client:searchResults', src, { items = items, query = query, reqId = reqId })
    end

    local encoded = urlEncode(query)

    PerformHttpRequest('https://www.youtube.com/youtubei/v1/search?prettyPrint=false&key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', function(code, body)
        if searchToken[src] ~= token or type(body) ~= 'string' or (tonumber(code) or 0) < 200 then return end
        local ok, data = pcall(json.decode, body)
        if not ok or type(data) ~= 'table' then return end
        local items, seen = {}, {}
        walkYoutubeVideos(data, items, seen, 0)
        finish(items)
    end, 'POST', json.encode({
        context = {
            client = {
                clientName = 'WEB',
                clientVersion = '2.20240725.00.00',
                hl = 'es',
                gl = 'MX'
            }
        },
        query = query
    }), {
        ['Content-Type'] = 'application/json',
        ['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    httpGet('https://www.youtube.com/results?sp=EgIQAQ%3D%3D&search_query=' .. encoded, function(code, body)
        if (tonumber(code) or 0) >= 200 then
            finish(parseYouTubeHtml(body))
        end
    end)

    local mirrors = {
        'https://inv.nadeko.net/api/v1/search?type=video&q=' .. encoded,
        'https://yewtu.be/api/v1/search?type=video&q=' .. encoded,
        'https://pipedapi.kavin.rocks/search?filter=videos&q=' .. encoded,
        'https://inv.tux.pizza/api/v1/search?type=video&q=' .. encoded
    }
    for _, url in ipairs(mirrors) do
        httpGet(url, function(code, body)
            if (tonumber(code) or 0) < 200 or type(body) ~= 'string' then return end
            local ok, data = pcall(json.decode, body)
            if ok then finish(parseInvidiousList(data)) end
        end)
    end

    SetTimeout(4200, function()
        if done or searchToken[src] ~= token then return end
        done = true
        TriggerClientEvent('carplay:client:searchResults', src, { items = {}, query = query, reqId = reqId })
    end)
end)

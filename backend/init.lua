local PLUGIN_NAME = "kzt_rub_converter"
local WEBKIT_LOADER_PATH = ".millennium\\Dist\\webkit.js"
local WEBKIT_CONFIG_PATH = ".millennium\\Dist\\converter_config.js"

local millennium = nil
local logger = nil
local plugin_log_path = nil
local FALLBACK_RUB_PER_KZT = 1 / 6
local RATE_TIMEOUT_SECONDS = 10
local RATE_PROVIDERS = {
    {
        name = "Freedom Bank KZ (non-cash)",
        url = "https://bankffin.kz/api/exchange-rates/getRates",
        pick = function(body)

            local rate = body:match(
                '"non_cash".-"buyCode"%s*:%s*"RUB".-"sellCode"%s*:%s*"KZT".-"sellRate"%s*:%s*"([%d%.]+)"'
            )

            rate = tonumber(rate)

            if rate then
                return 1 / rate
            end

            return nil
        end
    },
    {
        name = "cbr-xml-daily.ru",
        url = "https://www.cbr-xml-daily.ru/latest.js",
        pick = function(body)
            local kzt_per_rub = tonumber(body:match('"KZT"%s*:%s*([0-9.]+)'))
            if kzt_per_rub and kzt_per_rub > 0 then
                return 1 / kzt_per_rub
            end
            return nil
        end
    },
    {
        name = "ratata.money",
        url = "https://ratata.money/api/v1/rates/latest?base=KZT&symbols=RUB",
        pick = function(body)
            return tonumber(body:match('"RUB"%s*:%s*([0-9.]+)'))
        end
    },
    {
        name = "api.frankfurter.dev",
        url = "https://api.frankfurter.dev/v2/rate/KZT/RUB",
        pick = function(body)
            return tonumber(body:match('"rate"%s*:%s*([0-9.]+)'))
        end
    },
    {
        name = "open.er-api.com",
        url = "https://open.er-api.com/v6/latest/KZT",
        pick = function(body)
            return tonumber(body:match('"RUB"%s*:%s*([0-9.]+)'))
        end
    }
}

local function normalize_path(path)
    local normalized = tostring(path or "")

    normalized = normalized:gsub("/", "\\")
    normalized = normalized:gsub("\\+", "\\")

    if normalized:match("^%a:\\$") then
        return normalized
    end

    normalized = normalized:gsub("\\$", "")
    return normalized
end

local function path_join(...)
    local parts = { ... }
    local result = ""
    local i

    for i = 1, #parts do
        local part = tostring(parts[i] or "")
        if part ~= "" then
            part = normalize_path(part)

            if result == "" then
                result = part
            else
                result = result:gsub("\\$", "")
                part = part:gsub("^\\+", "")
                result = result .. "\\" .. part
            end
        end
    end

    return normalize_path(result)
end

local function get_current_plugin_dir()
    local info = debug.getinfo(1, "S")
    local source = info and info.source or ""

    if source:sub(1, 1) == "@" then
        source = source:sub(2)
    end

    source = normalize_path(source)
    source = source:gsub("\\[^\\]+$", "")

    return source:gsub("\\backend$", "")
end

local function append_file_log(level, message)
    if not plugin_log_path then
        return
    end

    local handle = io.open(plugin_log_path, "ab")
    if not handle then
        return
    end

    handle:write("[" .. os.date("%Y-%m-%d %H:%M:%S") .. "] [" .. level .. "] " .. tostring(message) .. "\n")
    handle:close()
end

local function log_to_millennium(level, message)
    if not logger then
        return
    end

    if level == "ERROR" and logger.error then
        pcall(function()
            logger:error(message)
        end)
    elseif level == "WARN" and logger.warn then
        pcall(function()
            logger:warn(message)
        end)
    elseif logger.info then
        pcall(function()
            logger:info(message)
        end)
    end
end

local function log_message(level, message)
    local formatted = "[" .. PLUGIN_NAME .. "] " .. tostring(message)

    append_file_log(level, formatted)
    log_to_millennium(level, formatted)
end

local function log_info(message)
    log_message("INFO", message)
end

local function log_warn(message)
    log_message("WARN", message)
end

local function log_error(message)
    log_message("ERROR", message)
end

local function fail(message)
    log_error(message)
    error(message, 2)
end

local function command_succeeded(result)
    if result == true or result == 0 then
        return true
    end

    if type(result) == "number" and result == 0 then
        return true
    end

    return false
end

local function file_exists(path)
    local handle = io.open(normalize_path(path), "rb")
    if handle then
        handle:close()
        return true
    end
    return false
end

local function read_file(path)
    local normalized = normalize_path(path)
    local handle, open_err = io.open(normalized, "rb")
    if not handle then
        return nil, "failed to open file for reading: " .. normalized .. " (" .. tostring(open_err) .. ")"
    end

    local content = handle:read("*a")
    local close_ok, close_err = handle:close()
    if close_ok == false then
        return nil, "failed to close file after reading: " .. normalized .. " (" .. tostring(close_err) .. ")"
    end

    if content == nil then
        return nil, "failed to read file: " .. normalized
    end

    return content
end

local function write_file(path, content)
    local normalized = normalize_path(path)
    local handle, open_err = io.open(normalized, "wb")
    if not handle then
        return nil, "failed to open file for writing: " .. normalized .. " (" .. tostring(open_err) .. ")"
    end

    local ok, write_err = handle:write(content)
    local close_ok, close_err = handle:close()

    if ok == nil then
        return nil, "failed to write file: " .. normalized .. " (" .. tostring(write_err) .. ")"
    end

    if close_ok == false then
        return nil, "failed to close file after writing: " .. normalized .. " (" .. tostring(close_err) .. ")"
    end

    return true
end

local function escape_js_string(value)
    return tostring(value or "")
        :gsub("\\", "\\\\")
        :gsub('"', '\\"')
        :gsub("\r", "\\r")
        :gsub("\n", "\\n")
end

local function fetch_url_content(url, destination_path, timeout_seconds)
    local command = 'curl.exe -L --silent --show-error --max-time ' .. tostring(timeout_seconds)
        .. ' -o "' .. normalize_path(destination_path) .. '" "' .. tostring(url) .. '"'

    if not command_succeeded(os.execute(command)) then
        return nil, "request failed"
    end

    local content, read_err = read_file(destination_path)
    os.remove(destination_path)

    if not content then
        return nil, read_err
    end

    return content
end

local function resolve_exchange_rate()
    local plugin_dir = get_current_plugin_dir()
    local temp_path = path_join(plugin_dir, "kzt_rub_rate.tmp")
    local i

    for i = 1, #RATE_PROVIDERS do
        local provider = RATE_PROVIDERS[i]
        local body
        local fetch_err
        local rate

        log_info("Requesting data from " .. provider.name .. "...")
        body, fetch_err = fetch_url_content(provider.url, temp_path, RATE_TIMEOUT_SECONDS)
        if body then
            rate = provider.pick(body)
            if rate and rate > 0 then
                log_info("[COMPLETE] " .. provider.name .. ": " .. tostring(rate))
                return rate, provider.name
            end
            log_warn("[FAILED] " .. provider.name .. ": bad response")
        else
            log_warn("[FAILED] " .. provider.name .. ": " .. tostring(fetch_err))
        end
    end

    log_info("Requesting data from Offline converter...")
    log_info("[COMPLETE] Offline converter: " .. tostring(FALLBACK_RUB_PER_KZT))
    return FALLBACK_RUB_PER_KZT, "Offline converter"
end

local function write_webkit_config(path, rate, source_name)
    local content = 'window.KZT_RUB_CONVERTER_CONFIG = { rubPerKzt: '
        .. string.format("%.12f", rate)
        .. ', source: "'
        .. escape_js_string(source_name)
        .. '" };\n'

    return write_file(path, content)
end

local function load_runtime_modules()
    local ok, result

    ok, result = pcall(require, "logger")
    if ok then
        logger = result
        log_info("Millennium logger module loaded")
    else
        append_file_log("WARN", "[" .. PLUGIN_NAME .. "] failed to load Millennium logger module: " .. tostring(result))
    end

    ok, result = pcall(require, "millennium")
    if ok then
        millennium = result
        log_info("Millennium API module loaded")
    else
        fail("failed to load Millennium API module: " .. tostring(result))
    end
end

local function prepare_webkit_config()
    local plugin_dir = get_current_plugin_dir()
    local source_js = path_join(plugin_dir, "webkit", "converter.js")
    local source_css = path_join(plugin_dir, "webkit", "converter.css")
    local loader_path = path_join(plugin_dir, WEBKIT_LOADER_PATH)
    local config_path = path_join(plugin_dir, WEBKIT_CONFIG_PATH)
    local ok, err
    local rate, rate_source

    log_info("backend loading")
    log_info("plugin path: " .. plugin_dir)
    log_info("source JS: " .. source_js)
    log_info("source CSS: " .. source_css)
    log_info("WebKit loader: " .. loader_path)
    log_info("WebKit config: " .. config_path)

    if not file_exists(source_js) then
        fail("source JS does not exist: " .. source_js)
    end

    if not file_exists(source_css) then
        fail("source CSS does not exist: " .. source_css)
    end

    if not file_exists(loader_path) then
        fail("WebKit loader does not exist: " .. loader_path)
    end

    rate, rate_source = resolve_exchange_rate()
    log_info("Selected exchange rate source: " .. tostring(rate_source))

    ok, err = write_webkit_config(config_path, rate, rate_source)
    if not ok then
        fail("failed to write WebKit config: " .. tostring(err))
    end
    log_info("WebKit config written successfully")
end

local function log_convertation_providers()
    log_info("Convertation providers:")
    log_info("- cbr-xml-daily.ru")
    log_info("- ratata.money")
    log_info("- api.frankfurter.dev")
    log_info("- open.er-api.com")
    log_info("- Offline converter")
end

local function on_load_impl()
    plugin_log_path = path_join(get_current_plugin_dir(), "kzt_rub_converter.log")
    append_file_log("INFO", "[" .. PLUGIN_NAME .. "] file logger initialized: " .. plugin_log_path)

    load_runtime_modules()
    log_convertation_providers()
    prepare_webkit_config()

    log_info("calling millennium.ready()")
    millennium.ready()
end

local function on_load()
    local ok, err = xpcall(on_load_impl, debug.traceback)
    if not ok then
        log_error("on_load failed:\n" .. tostring(err))

        if millennium and millennium.ready then
            pcall(function()
                millennium.ready()
            end)
            log_warn("called millennium.ready() after on_load failure to keep plugin logs visible")
        end
    end
end

local function on_unload()
end

return {
    on_load = on_load,
    on_unload = on_unload
}

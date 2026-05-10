#!/usr/bin/env ruby
# frozen_string_literal: true

require 'bigdecimal'
require 'csv'
require 'digest'
require 'json'
require 'net/http'
require 'optparse'
require 'stringio'
require 'time'
require 'uri'
require 'zlib'

SHEET_ID = '1JNki_PKe9bd-yjtbuAQGZxDLOvY2Cyjs3OGyQTt7hOY'
SHEET_GID = '742012087'
SHEET_EXPORT_URL = "https://docs.google.com/spreadsheets/d/#{SHEET_ID}/export?format=csv&gid=#{SHEET_GID}"
SOURCE_SHEET_URL = "https://docs.google.com/spreadsheets/d/#{SHEET_ID}/edit?gid=#{SHEET_GID}"
SNAPSHOT_DATE = '2026-05-10'
EXPECTED_ROW_COUNT = 12_806

EXPECTED_HEADERS = [
  'id',
  'product_id',
  'product_name',
  'print_option',
  'lead_time_type',
  'lead_time_days_min',
  'lead_time_days_max',
  'quantity',
  'unit_price',
  'currency',
  'is_moq',
  'created_at',
  'updated_at',
  'product_source',
  'print_vendor_source',
  'Item Unit Cost',
  'Total Item Cost',
  'no_of_print_methods',
  'print_method_1',
  'no_of_positions_1',
  'print_method_1_cost',
  'packet or unit_cost_1',
  'print_method_2',
  'print_method_2_cost',
  'packet or unit_cost_2',
  'Block Charges (if any)',
  'Total Print Cost',
  'average Print Unit Cost',
  'profit snapshot 10-May-2026',
  'profit percentage snapshot 10-May-2026'
].freeze

A_TO_M_HEADERS = EXPECTED_HEADERS.first(13).freeze
N_TO_AD_HEADERS = EXPECTED_HEADERS[13..].freeze

def env_load(path)
  File.readlines(path).each_with_object({}) do |line, env|
    stripped = line.strip
    next if stripped.empty? || stripped.start_with?('#') || !stripped.include?('=')

    key, value = stripped.split('=', 2)
    env[key] = value
  end
end

def decode_body(response)
  case response['content-encoding']
  when 'gzip'
    Zlib::GzipReader.new(StringIO.new(response.body)).read
  when 'deflate'
    Zlib::Inflate.inflate(response.body)
  else
    response.body
  end
end

def http_request(uri, request, redirects: 10)
  raise 'too many redirects' if redirects <= 0

  response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https') do |http|
    http.request(request)
  end

  if response.is_a?(Net::HTTPRedirection)
    location = response['location']
    location = URI.join(uri.to_s, location).to_s unless location.match?(/\Ahttps?:/i)
    redirect_uri = URI(location)
    redirect_request = Net::HTTP::Get.new(redirect_uri)
    redirect_request['Accept-Encoding'] = 'identity'
    return http_request(redirect_uri, redirect_request, redirects: redirects - 1)
  end

  body = decode_body(response)
  unless response.code.to_i.between?(200, 299)
    raise "HTTP #{response.code}: #{body[0, 500]}"
  end

  [body, response]
end

def fetch_sheet_rows
  uri = URI(SHEET_EXPORT_URL)
  request = Net::HTTP::Get.new(uri)
  request['Accept-Encoding'] = 'identity'
  body, = http_request(uri, request)
  CSV.parse(body, headers: true, liberal_parsing: true)
end

def canonical_decimal(value)
  return '' if value.nil? || value.to_s.empty?

  BigDecimal(value.to_s.delete('%,')).to_s('F')
                                .sub(/(\.\d*?)0+\z/, '\1')
                                .sub(/\.\z/, '')
end

def canonical_timestamp(value)
  return '' if value.nil? || value.to_s.empty?

  formatted = Time.parse(value.to_s.tr('T', ' ')).utc.strftime('%Y-%m-%d %H:%M:%S.%6N')
  "#{formatted.sub(/(\.\d*?)0+\z/, '\1').sub(/\.\z/, '')}+00"
end

def canonical_am_value(header, value)
  case header
  when 'unit_price'
    canonical_decimal(value)
  when 'is_moq'
    value.to_s.downcase
  when 'created_at', 'updated_at'
    canonical_timestamp(value)
  else
    value.to_s
  end
end

def am_digest(rows)
  row_strings = rows.map do |row|
    A_TO_M_HEADERS.map { |header| canonical_am_value(header, row[header]) }.join("\x1F")
  end.sort

  Digest::MD5.hexdigest(row_strings.join("\x1E"))
end

def blank_to_nil(value)
  value.nil? || value.to_s.empty? ? nil : value
end

def numeric_or_nil(value)
  return nil if value.nil? || value.to_s.empty?

  canonical_decimal(value)
end

def integer_or_nil(value)
  return nil if value.nil? || value.to_s.empty?

  Integer(value)
end

def snapshot_payload(row)
  raw = N_TO_AD_HEADERS.each_with_object({}) { |header, hash| hash[header] = row[header].to_s }

  {
    pricing_id: row['id'],
    product_source: blank_to_nil(row['product_source']),
    print_vendor_source: blank_to_nil(row['print_vendor_source']),
    item_unit_cost: numeric_or_nil(row['Item Unit Cost']),
    total_item_cost: numeric_or_nil(row['Total Item Cost']),
    no_of_print_methods: integer_or_nil(row['no_of_print_methods']),
    print_method_1: blank_to_nil(row['print_method_1']),
    no_of_positions_1: integer_or_nil(row['no_of_positions_1']),
    print_method_1_cost: numeric_or_nil(row['print_method_1_cost']),
    print_method_1_cost_basis: blank_to_nil(row['packet or unit_cost_1']),
    print_method_2: blank_to_nil(row['print_method_2']),
    print_method_2_cost: numeric_or_nil(row['print_method_2_cost']),
    print_method_2_cost_basis: blank_to_nil(row['packet or unit_cost_2']),
    block_charges: numeric_or_nil(row['Block Charges (if any)']),
    total_print_cost: numeric_or_nil(row['Total Print Cost']),
    average_print_unit_cost: numeric_or_nil(row['average Print Unit Cost']),
    benchmark_profit_amount: numeric_or_nil(row['profit snapshot 10-May-2026']),
    benchmark_profit_percentage: numeric_or_nil(row['profit percentage snapshot 10-May-2026']),
    raw_snapshot: raw
  }
end

def validate_sheet!(rows)
  unless rows.headers == EXPECTED_HEADERS
    raise "unexpected headers:\nexpected=#{EXPECTED_HEADERS.inspect}\nactual=#{rows.headers.inspect}"
  end

  raise "unexpected row count: #{rows.length}" unless rows.length == EXPECTED_ROW_COUNT

  ids = rows.map { |row| row['id'].to_s }
  counts = Hash.new(0)
  ids.each { |id| counts[id] += 1 }
  duplicate_ids = counts.select { |_id, count| count > 1 }.keys
  raise "duplicate ids found: #{duplicate_ids.first(10).inspect}" unless duplicate_ids.empty?
end

def post_rpc!(supabase_url, key, payload)
  uri = URI("#{supabase_url}/rest/v1/rpc/_import_pricing_benchmark_snapshot_batch")
  request = Net::HTTP::Post.new(uri)
  request['Accept-Encoding'] = 'identity'
  request['apikey'] = key
  request['Authorization'] = "Bearer #{key}"
  request['Content-Type'] = 'application/json'
  request.body = JSON.generate(payload)

  body, = http_request(uri, request)
  JSON.parse(body)
end

options = { validate_only: false }
OptionParser.new do |parser|
  parser.on('--validate-only') { options[:validate_only] = true }
end.parse!

rows = fetch_sheet_rows
validate_sheet!(rows)
sheet_digest = am_digest(rows)

expected_digest = ENV['EXPECTED_AM_DIGEST']
if expected_digest && expected_digest != sheet_digest
  raise "A:M digest mismatch: expected #{expected_digest}, got #{sheet_digest}"
end

puts JSON.pretty_generate(
  status: 'validated',
  rows: rows.length,
  am_digest: sheet_digest,
  snapshot_date: SNAPSHOT_DATE
)

exit 0 if options[:validate_only]

env = env_load(File.expand_path('../backend/.env', __dir__))
supabase_url = env.fetch('SUPABASE_URL')
supabase_key = env.fetch('SUPABASE_SERVICE_KEY')
token = ENV.fetch('IMPORT_RPC_TOKEN')

payload = {
  p_token: token,
  p_snapshot_date: SNAPSHOT_DATE,
  p_source_sheet_url: SOURCE_SHEET_URL,
  p_source_sheet_gid: SHEET_GID,
  p_source_row_count: rows.length,
  p_source_headers: EXPECTED_HEADERS,
  p_notes: 'Imported Google Sheet pricing benchmark columns N:AD.',
  p_rows: rows.map { |row| snapshot_payload(row) }
}

result = post_rpc!(supabase_url, supabase_key, payload)
puts JSON.pretty_generate(status: 'imported', result: result)

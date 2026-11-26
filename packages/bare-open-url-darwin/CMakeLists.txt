cmake_minimum_required(VERSION 4.0)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)

project(bare_open_url_darwin C OBJC)

add_bare_module(bare_open_url_darwin)

target_sources(
  ${bare_open_url_darwin}
  PRIVATE
    binding.m
)

target_link_libraries(
  ${bare_open_url_darwin}
  PRIVATE
    "-framework Foundation"
    "-framework AppKit"
)

target_compile_options(
  ${bare_open_url_darwin}
  PRIVATE
    -fobjc-arc
)

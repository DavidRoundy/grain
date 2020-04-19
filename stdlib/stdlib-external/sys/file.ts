import { malloc, free, throwError } from "../ascutils/grainRuntime";

import {
  errno,
  lookupflags,
  oflags,
  rights,
  fdflags,
  path_open,
  fd_read,
  fd_write,
} from "bindings/wasi";

import { GRAIN_ERR_SYSTEM } from "../ascutils/errors";

import { GRAIN_GENERIC_HEAP_TAG_TYPE, GRAIN_STRING_HEAP_TAG, GRAIN_TUPLE_TAG_TYPE } from "../ascutils/tags";

import { loadAdtVal, loadAdtVariant, stringSize, allocateString, allocateTuple } from '../ascutils/dataStructures'

namespace glookupflag {
  // @ts-ignore: decorator
  @inline
  export const SymlinkFollow: u32 = 0
}

namespace goflag {
  // @ts-ignore: decorator
  @inline
  export const Create: u32 = 0
  // @ts-ignore: decorator
  @inline
  export const Directory: u32 = 2
  // @ts-ignore: decorator
  @inline
  export const Exclusive: u32 = 4
  // @ts-ignore: decorator
  @inline
  export const Truncate: u32 = 6
}

namespace grights {
  // @ts-ignore decorator
  @inline
  export const FdDatasync: u32 = 0
  // @ts-ignore decorator
  @inline
  export const FdRead: u32 = 2
  // @ts-ignore decorator
  @inline
  export const FdSeek: u32 = 4
  // @ts-ignore decorator
  @inline
  export const FdFdstatSetFlags: u32 = 6
  // @ts-ignore decorator
  @inline
  export const FdSync: u32 = 8
  // @ts-ignore decorator
  @inline
  export const FdTell: u32 = 10
  // @ts-ignore decorator
  @inline
  export const FdWrite: u32 = 12
  // @ts-ignore decorator
  @inline
  export const FdAdvise: u32 = 14
  // @ts-ignore decorator
  @inline
  export const FdAllocate: u32 = 16
  // @ts-ignore decorator
  @inline
  export const PathCreateDirectory: u32 = 18
  // @ts-ignore decorator
  @inline
  export const PathCreateFile: u32 = 20
  // @ts-ignore decorator
  @inline
  export const PathLinkSource: u32 = 22
  // @ts-ignore decorator
  @inline
  export const PathLinkTarget: u32 = 24
  // @ts-ignore decorator
  @inline
  export const PathOpen: u32 = 26
  // @ts-ignore decorator
  @inline
  export const FdReaddir: u32 = 28
  // @ts-ignore decorator
  @inline
  export const PathReadlink: u32 = 30
  // @ts-ignore decorator
  @inline
  export const PathRenameSource: u32 = 32
  // @ts-ignore decorator
  @inline
  export const PathRenameTarget: u32 = 34
  // @ts-ignore decorator
  @inline
  export const PathFilestatGet: u32 = 36
  // @ts-ignore decorator
  @inline
  export const PathFilestatSetSize: u32 = 38
  // @ts-ignore decorator
  @inline
  export const PathFilestatSetTimes: u32 = 40
  // @ts-ignore decorator
  @inline
  export const FdFilestatGet: u32 = 42
  // @ts-ignore decorator
  @inline
  export const FdFilestatSetSize: u32 = 44
  // @ts-ignore decorator
  @inline
  export const FdFilestatSetTimes: u32 = 46
  // @ts-ignore decorator
  @inline
  export const PathSymlink: u32 = 48
  // @ts-ignore decorator
  @inline
  export const PathRemoveDirectory: u32 = 50
  // @ts-ignore decorator
  @inline
  export const PathUnlinkFile: u32 = 52
  // @ts-ignore decorator
  @inline
  export const PollFdReadwrite: u32 = 54
  // @ts-ignore decorator
  @inline
  export const SockShutdown: u32 = 56
}

namespace gfdflag {
  // @ts-ignore decorator
  @inline
  export const Append: u32 = 0
  // @ts-ignore decorator
  @inline
  export const Dsync: u32 = 2
  // @ts-ignore decorator
  @inline
  export const Nonblock: u32 = 4
  // @ts-ignore decorator
  @inline
  export const Rsync: u32 = 6
  // @ts-ignore decorator
  @inline
  export const Sync: u32 = 8
}

function combineRights(grightsl: u32): u64 {
  let combinedRights: u64 = 0
  let listPtr = grightsl ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  while (loadAdtVariant(listPtr) !== 0) {
    let adt = loadAdtVal(listPtr, 0) ^ GRAIN_GENERIC_HEAP_TAG_TYPE
    switch (loadAdtVariant(adt)) {
      case grights.FdDatasync: {
        combinedRights = combinedRights | rights.FD_DATASYNC
        break
      }
      case grights.FdRead: {
        combinedRights = combinedRights | rights.FD_READ
        break
      }
      case grights.FdSeek: {
        combinedRights = combinedRights | rights.FD_SEEK
        break
      }
      case grights.FdFdstatSetFlags: {
        combinedRights = combinedRights | rights.FD_FDSTAT_SET_FLAGS
        break
      }
      case grights.FdSync: {
        combinedRights = combinedRights | rights.FD_SYNC
        break
      }
      case grights.FdTell: {
        combinedRights = combinedRights | rights.FD_TELL
        break
      }
      case grights.FdWrite: {
        combinedRights = combinedRights | rights.FD_WRITE
        break
      }
      case grights.FdAdvise: {
        combinedRights = combinedRights | rights.FD_ADVISE
        break
      }
      case grights.FdAllocate: {
        combinedRights = combinedRights | rights.FD_ALLOCATE
        break
      }
      case grights.PathCreateDirectory: {
        combinedRights = combinedRights | rights.PATH_CREATE_DIRECTORY
        break
      }
      case grights.PathCreateFile: {
        combinedRights = combinedRights | rights.PATH_CREATE_FILE
        break
      }
      case grights.PathLinkSource: {
        combinedRights = combinedRights | rights.PATH_LINK_SOURCE
        break
      }
      case grights.PathLinkTarget: {
        combinedRights = combinedRights | rights.PATH_LINK_TARGET
        break
      }
      case grights.PathOpen: {
        combinedRights = combinedRights | rights.PATH_OPEN
        break
      }
      case grights.FdReaddir: {
        combinedRights = combinedRights | rights.FD_READDIR
        break
      }
      case grights.PathReadlink: {
        combinedRights = combinedRights | rights.PATH_READLINK
        break
      }
      case grights.PathRenameSource: {
        combinedRights = combinedRights | rights.PATH_RENAME_SOURCE
        break
      }
      case grights.PathRenameTarget: {
        combinedRights = combinedRights | rights.PATH_RENAME_TARGET
        break
      }
      case grights.PathFilestatGet: {
        combinedRights = combinedRights | rights.PATH_FILESTAT_GET
        break
      }
      case grights.PathFilestatSetSize: {
        combinedRights = combinedRights | rights.PATH_FILESTAT_SET_SIZE
        break
      }
      case grights.PathFilestatSetTimes: {
        combinedRights = combinedRights | rights.PATH_FILESTAT_SET_TIMES
        break
      }
      case grights.FdFilestatGet: {
        combinedRights = combinedRights | rights.FD_FILESTAT_GET
        break
      }
      case grights.FdFilestatSetSize: {
        combinedRights = combinedRights | rights.FD_FILESTAT_SET_SIZE
        break
      }
      case grights.FdFilestatSetTimes: {
        combinedRights = combinedRights | rights.FD_FILESTAT_SET_TIMES
        break
      }
      case grights.PathSymlink: {
        combinedRights = combinedRights | rights.RIGHT_PATH_SYMLINK
        break
      }
      case grights.PathRemoveDirectory: {
        combinedRights = combinedRights | rights.PATH_REMOVE_DIRECTORY
        break
      }
      case grights.PathUnlinkFile: {
        combinedRights = combinedRights | rights.PATH_UNLINK_FILE
        break
      }
      case grights.PollFdReadwrite: {
        combinedRights = combinedRights | rights.POLL_FD_READWRITE
        break
      }
      case grights.SockShutdown: {
        combinedRights = combinedRights | rights.SOCK_SHUTDOWN
        break
      }
    }
    listPtr = loadAdtVal(listPtr, 1) ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  }

  return combinedRights
}

function combineFdFlags(flagsl: u32): u16 {
  let combinedFdFlags: u16 = 0
  let listPtr = flagsl ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  while (loadAdtVariant(listPtr) !== 0) {
    let adt = loadAdtVal(listPtr, 0) ^ GRAIN_GENERIC_HEAP_TAG_TYPE
    switch (loadAdtVariant(adt)) {
      case gfdflag.Append: {
        combinedFdFlags = combinedFdFlags | fdflags.APPEND
        break
      }
      case gfdflag.Dsync: {
        combinedFdFlags = combinedFdFlags | fdflags.DSYNC
        break
      }
      case gfdflag.Nonblock: {
        combinedFdFlags = combinedFdFlags | fdflags.NONBLOCK
        break
      }
      case gfdflag.Rsync: {
        combinedFdFlags = combinedFdFlags | fdflags.RSYNC
        break
      }
      case gfdflag.Sync: {
        combinedFdFlags = combinedFdFlags | fdflags.SYNC
        break
      }
    }
    listPtr = loadAdtVal(listPtr, 1) ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  }

  return combinedFdFlags
}

export function pathOpen(
  dirfd: u32,
  dirflags: u32,
  path: u32,
  openflags: u32,
  fsRightsBase: u32,
  fsRightsInheriting: u32,
  fsFlags: u32
): u32 {
  dirfd = dirfd ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  let dirfdval = loadAdtVal(dirfd, 0) >> 1
  
  let combinedDirFlags: u32 = 0
  let listPtr = dirflags ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  while (loadAdtVariant(listPtr) !== 0) {
    let adt = loadAdtVal(listPtr, 0) ^ GRAIN_GENERIC_HEAP_TAG_TYPE
    switch (loadAdtVariant(adt)) {
      case glookupflag.SymlinkFollow: {
        combinedDirFlags = combinedDirFlags | lookupflags.SYMLINK_FOLLOW
        break
      }
    }
    listPtr = loadAdtVal(listPtr, 1) ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  }

  path = path ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  let pathLength = stringSize(path)
  path += 8 // Offset the string pointer to the start of the string

  let combinedOFlags: u16 = 0
  listPtr = openflags ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  while (loadAdtVariant(listPtr) !== 0) {
    let adt = loadAdtVal(listPtr, 0) ^ GRAIN_GENERIC_HEAP_TAG_TYPE
    switch (loadAdtVariant(adt)) {
      case goflag.Create: {
        combinedOFlags = combinedOFlags | oflags.CREAT
        break
      }
      case goflag.Directory: {
        combinedOFlags = combinedOFlags | oflags.DIRECTORY
        break
      }
      case goflag.Exclusive: {
        combinedOFlags = combinedOFlags | oflags.EXCL
        break
      }
      case goflag.Truncate: {
        combinedOFlags = combinedOFlags | oflags.TRUNC
        break
      }
    }
    listPtr = loadAdtVal(listPtr, 1) ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  }

  let rightsBase = combineRights(fsRightsBase)
  let rightsInheriting = combineRights(fsRightsInheriting)
  
  let combinedFsFlags = combineFdFlags(fsFlags)

  let newFd = malloc(6 * 4)
  memory.copy(newFd, dirfd, 6 * 4)

  let fdPtr = newFd + (5 * 4)
  
  let err = path_open(
    dirfdval,
    combinedDirFlags,
    path,
    pathLength,
    combinedOFlags,
    rightsBase,
    rightsInheriting,
    combinedFsFlags,
    fdPtr
  )
  if (err !== errno.SUCCESS) {
    free(newFd)
    throwError(GRAIN_ERR_SYSTEM, err << 1, 0)
  }

  // Tag fd
  store<u32>(newFd, load<u32>(newFd, 5 * 4) << 1, 5 * 4)
  
  return newFd ^ GRAIN_GENERIC_HEAP_TAG_TYPE
}

export function fdRead(fdPtr: u32, n: u32): u32 {
  fdPtr = fdPtr ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  let fd = loadAdtVal(fdPtr, 0) >> 1

  n = n >> 1

  let iovs = malloc(3 * 4)
  let strPtr = allocateString(n)

  store<u32>(iovs, strPtr + (2 * 4))
  store<u32>(iovs, n, 4)

  let nread = iovs + (3 * 4)

  let err = fd_read(fd, iovs, 1, nread)
  if (err !== errno.SUCCESS) {
    free(iovs)
    free(strPtr)
    throwError(GRAIN_ERR_SYSTEM, err << 1, 0)
  }

  nread = load<u32>(nread)
  
  let tuple = allocateTuple(2)

  store<u32>(tuple, strPtr ^ GRAIN_GENERIC_HEAP_TAG_TYPE, 4)
  store<u32>(tuple, nread << 1, 2 * 4)
  store<u32>(strPtr, nread, 4)

  free(iovs)

  return tuple ^ GRAIN_TUPLE_TAG_TYPE
}

export function fdWrite(fdPtr: u32, data: u32): u32 {
  fdPtr = fdPtr ^ GRAIN_GENERIC_HEAP_TAG_TYPE
  let fd = loadAdtVal(fdPtr, 0) >> 1

  let iovs = malloc(3 * 4)
  let strPtr = data ^ GRAIN_GENERIC_HEAP_TAG_TYPE

  store<u32>(iovs, strPtr + (2 * 4))
  store<u32>(iovs, load<u32>(strPtr, 4), 4)

  let nwritten = iovs + (3 * 4)

  let err = fd_write(fd, iovs, 1, nwritten)
  if (err !== errno.SUCCESS) {
    free(iovs)
    throwError(GRAIN_ERR_SYSTEM, err << 1, 0)
  }

  nwritten = load<u32>(nwritten)
  
  free(iovs)

  return nwritten << 1
}